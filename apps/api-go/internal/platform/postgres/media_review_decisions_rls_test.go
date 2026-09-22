package postgres

import (
	"context"
	"strings"
	"testing"
	"time"
)

// RLS-DRIFT-001
//
// 本仓库的 observer 边界靠 **REVOKE 裸表 + 聚合视图**（047/051/053），RLS 从来不是
// 那道边界 —— 065 的注释亲口写明，cmd/data-audit 的 observer_raw_table_privileges
// 检查也在守这一条。但库里有几张表被开过 ENABLE + FORCE ROW LEVEL SECURITY 却
// **零 policy**（scene.scenes / scene.invitations / contribution.contributions，
// 与 065 修掉的 supply 两表同一类漂移；media.media_review_decisions 则是 032 只建了
// SELECT policy、漏了 INSERT）。
//
// FORCE RLS + 零适用 policy = deny-all，而它的表现极难发现：
//   - SELECT **不报错，静默返回 0 行** —— "没有数据"和"没有权限"长得一模一样；
//   - INSERT/UPDATE/DELETE 报 row-level security policy 错误，但
//     media/service.go:1348 把审计写入做成**软失败**，所以用户看不到任何异常。
//
// 2026-09-22 实测（本地库，连接角色 proxy，rolsuper=f）：
//
//	scene.scenes 真实 6 行 -> 0；contribution.contributions 3 -> 0；
//	scene.invitations 3 -> 0；media.media_review_decisions 1 -> 0 且写不进去。
//
// 这条钉是**一般化**的：不枚举今天这几张表，而是要求"凡是开了 RLS 的表，连接角色
// 必须至少有一条适用 policy"。下一张被漂移开上 RLS 的表会自动被抓住。
//
// 为什么这个洞能在仓库自己的测试里活这么久：testdb_test.go 的临时集群是
// `initdb -U proxy` 建的，那里的 proxy 是**超级用户**，而超级用户绕过 RLS。
// 也就是说本包所有集成测试测的权限模型和真实部署不是一回事 —— 所以这条钉断言的是
// **结构**（privilege + pg_policy），而不是"插一行试试"，那样在临时集群里恒绿。
func TestNoTableHasUnusableRowLevelSecurity(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	var currentRole string
	if err := pool.QueryRow(ctx, `SELECT current_user`).Scan(&currentRole); err != nil {
		t.Fatalf("current_user: %v", err)
	}

	rows, err := pool.Query(ctx, `
		SELECT n.nspname || '.' || c.relname AS tbl,
		       pg_get_userbyid(c.relowner) AS owner,
		       has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
		       (SELECT count(*) FROM pg_policy p
		         WHERE p.polrelid = c.oid
		           AND (p.polroles = '{0}'::oid[]
		                OR p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = current_user)])) AS app_policies
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind IN ('r','p') AND c.relrowsecurity
		  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
		ORDER BY 1`)
	if err != nil {
		t.Fatalf("sweep RLS tables: %v", err)
	}
	defer rows.Close()

	type rlsTable struct {
		tbl, owner string
		canInsert  bool
		policies   int
	}
	var found []rlsTable
	for rows.Next() {
		var f rlsTable
		if err := rows.Scan(&f.tbl, &f.owner, &f.canInsert, &f.policies); err != nil {
			t.Fatalf("scan RLS sweep: %v", err)
		}
		found = append(found, f)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("RLS sweep rows: %v", err)
	}

	sawAuditTable := false
	for _, f := range found {
		if f.tbl == "media.media_review_decisions" {
			sawAuditTable = true
		}
		if !f.canInsert {
			t.Errorf("RLS-DRIFT-001: %s 开了 row level security，但连接角色 %q（属主 %s）连 INSERT 权限都没有 —— 写路径会 permission denied。",
				f.tbl, currentRole, f.owner)
		}
		if f.policies == 0 {
			t.Errorf("RLS-DRIFT-001: %s 开了 row level security（relrowsecurity=true）却没有任何 policy 适用于连接角色 %q —— "+
				"此时 SELECT 会静默返回 0 行、写入报 row-level security policy 错误，而调用方两者都看不见。"+
				"要么给它补 policy（112 的做法），要么按 065/111 显式 DISABLE ROW LEVEL SECURITY。",
				f.tbl, currentRole)
		}
	}

	// 正向对照：这条钉必须真的在检查东西。若有人"顺手"把 RLS 全关掉，
	// found 会变空、循环变成真空绿 —— 所以钉住审计表必须仍在 RLS 之下
	// （FORCE RLS + 只有 SELECT/INSERT policy 是 112 的设计，不是遗漏）。
	if !sawAuditTable {
		t.Errorf("RLS-DRIFT-001: media.media_review_decisions 不再处于 RLS 之下 —— 它是防篡改审计链，" +
			"FORCE RLS + 只有 SELECT/INSERT policy 才是设计（见 112）。")
	}
	t.Logf("RLS-DRIFT-001: 以角色 %q 检查了 %d 张开了 RLS 的表", currentRole, len(found))
}

// MEDIA-REVIEW-AUDIT-001（append-only 那一半）
//
// 112 给应用角色补了 SELECT + INSERT policy，**故意不给** UPDATE/DELETE ——
// 配合 FORCE RLS，连表属主也改不了审计行，032 的 append-only 意图由 DB 兜住。
// 这条钉守的就是那个"故意不给"：有人图省事加一条 ALL policy，审计链立刻可篡改，
// 而所有功能测试仍然是绿的。
func TestMediaReviewDecisionAuditTrailIsAppendOnlyForAppRole(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	var forceRLS bool
	if err := pool.QueryRow(ctx, `
		SELECT c.relforcerowsecurity
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'media' AND c.relname = 'media_review_decisions'`).Scan(&forceRLS); err != nil {
		t.Fatalf("read relforcerowsecurity: %v", err)
	}
	if !forceRLS {
		t.Errorf("MEDIA-REVIEW-AUDIT-001: FORCE ROW LEVEL SECURITY 掉了 —— 属主会绕过 policy，" +
			"append-only 就只剩「代码里没人写 UPDATE」这一层（032 明确要 DB 层兜住）。")
	}

	rows, err := pool.Query(ctx, `
		SELECT p.polcmd::text, count(*)
		FROM pg_policy p
		WHERE p.polrelid = 'media.media_review_decisions'::regclass
		  AND (p.polroles = '{0}'::oid[]
		       OR p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname = current_user)])
		GROUP BY 1`)
	if err != nil {
		t.Fatalf("read policies: %v", err)
	}
	defer rows.Close()

	cmds := map[string]int{}
	for rows.Next() {
		var cmd string
		var n int
		if err := rows.Scan(&cmd, &n); err != nil {
			t.Fatalf("scan policy: %v", err)
		}
		cmds[cmd] = n
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("policy rows: %v", err)
	}

	if cmds["r"] == 0 {
		t.Errorf("MEDIA-REVIEW-AUDIT-001: 应用角色没有 SELECT policy —— 审计行读回来是静默 0 行（112 应该建它）。")
	}
	if cmds["a"] == 0 {
		t.Errorf("MEDIA-REVIEW-AUDIT-001: 应用角色没有 INSERT policy —— 审核决定写不进去，" +
			"而 service 侧是软失败，所以线上只表现为审计链永远为空（112 应该建它）。")
	}
	for _, forbidden := range []string{"w", "d", "*", "t"} {
		if cmds[forbidden] > 0 {
			t.Errorf("MEDIA-REVIEW-AUDIT-001: 应用角色拿到 polcmd=%q 的 policy —— "+
				"审计表变成可改/可删/可截断，append-only 破了（032/033 明确只 INSERT）。", forbidden)
		}
	}
	t.Logf("MEDIA-REVIEW-AUDIT-001: app-role policy cmds = %v", cmds)
}

// MEDIA-REVIEW-PARTITION-001
//
// 035 建了 2025-09 .. 2026-08 的月分区，042 声称补 p2026_08 .. p2027_07，
// 但 042 的整个函数体挂在一个 `IF NOT EXISTS (relkind='p')` 守卫下，而 035 之后
// 这张表已经是分区表 ⇒ 042 的 body 从落地起就是不可达死代码（113 修掉）。
// 窗口过期后新决策全落进 default：按月 detach/archive 的能力失效，default 无界增长。
//
// 用**一次真实写入**问分区路由，而不是解析 relpartbound 文本 —— 文本解析很脆，
// 而"这行会落到哪个分区"正是要守的东西。
func TestMediaReviewDecisionPartitionWindowCoversNow(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := time.Now().UnixNano()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	assetID := "media_asset_part_" + itoa(run)
	if _, err := tx.Exec(ctx, `
		INSERT INTO media.media_assets (
			media_asset_id, owner_principal_type, owner_principal_id, media_type,
			original_storage_key, processing_status, moderation_status, visibility_class,
			created_at, updated_at)
		VALUES ($1,'INDIVIDUAL',$2,'IMAGE',$3,'READY','QUARANTINED','OWNER_ONLY',now(),now())`,
		assetID, "user_partition_probe_"+itoa(run), "test://"+assetID+"/original.jpg"); err != nil {
		t.Fatalf("seed asset: %v", err)
	}

	decisionID := "mrd_part_" + itoa(run)
	if _, err := tx.Exec(ctx, `
		INSERT INTO media.media_review_decisions (
			decision_id, media_asset_id, from_status, to_status, reason, note, operator_id, reviewed_at)
		VALUES ($1,$2,'QUARANTINED','APPROVED','APPROVE','','opr_partition_probe', now())`,
		decisionID, assetID); err != nil {
		t.Fatalf("append probe decision: %v", err)
	}

	var landed string
	if err := tx.QueryRow(ctx,
		`SELECT tableoid::regclass::text FROM media.media_review_decisions WHERE decision_id = $1`,
		decisionID).Scan(&landed); err != nil {
		t.Fatalf("read tableoid: %v", err)
	}

	if strings.HasSuffix(landed, "_default") {
		t.Errorf("MEDIA-REVIEW-PARTITION-001: 当前月份的决策落进了 default 分区（%s）—— "+
			"月分区窗口已过期（035 到 2026-08，042 的 p2026_08..p2027_07 是不可达死代码）。"+
			"补窗口：SELECT media.create_next_month_partition('<下个月的 1 号>'::date); 或加一条迁移（113 的形状）。",
			landed)
	}
	t.Logf("MEDIA-REVIEW-PARTITION-001: 当前月份的决策落在 %s", landed)
}
