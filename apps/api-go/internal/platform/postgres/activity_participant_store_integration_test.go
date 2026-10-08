package postgres

// STORE-ATTRIBUTION-P1（钉）：报名单（activity.participants 一行 = 一单）必须记下它
// 属于哪家门店，口径与 ProjectActivityOrder / 回填 156 **同一条**：活动 payload 里的
// realitySceneId → 认领该场景的门店 ORDER BY id LIMIT 1；场景没人认领 ⇒ NULL。
//
// 为什么必须对真库跑：store_id 是 ALTER TABLE 加的，写它的是 Join 事务里那条 INSERT。
// 内存仓储和不带 participants 表的单测里，「INSERT 少了一列」这种错根本不存在；而
// 「没人认领却写了个 '' / 写到了不该写的店」这类错，更只有在真 schema 上把两场活动
// 各下一单、逐行读回来才看得见（operator_merchant_read_model_integration_test.go 是
// 同一个理由）。

import (
	"context"
	"testing"
	"time"

	"github.com/proxy-app/proxy-api/internal/activity"
)

func TestJoinRecordsStoreClaimingTheActivityScene(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	run := itoa(time.Now().UnixNano())

	claimedScene := "scene_attrib_claimed_" + run
	unclaimedScene := "scene_attrib_unclaimed_" + run
	owner, biz := "user_attrib_"+run, "biz_attrib_"+run
	// 同场景两家认领：id 小的 st_attrib_a 赢。这条断言才是「用的是那一条规则」的
	// 证据 —— 只断言「拿到了某家店」的话，把 ORDER BY 换成别的排法照样绿。
	storeMin, storeOther := "st_attrib_a_"+run, "st_attrib_b_"+run
	actClaimed, actUnclaimed := "act_attrib_claimed_"+run, "act_attrib_unclaimed_"+run

	seedBusinessUsersPG(t, pool, []string{owner})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	// 清理顺序：先报名与活动，再 store_lines 之类子表、门店、主体、账号 ——
	// 049 给 business.accounts.owner_user_id 加了 ON DELETE RESTRICT，账号必须最后删。
	t.Cleanup(func() {
		bg := context.Background()
		for _, id := range []string{actClaimed, actUnclaimed} {
			if _, err := pool.Exec(bg, `DELETE FROM activity.participants WHERE activity_id=$1`, id); err != nil {
				t.Errorf("cleanup participants %s: %v", id, err)
			}
			if _, err := pool.Exec(bg, `DELETE FROM activity.activities WHERE id=$1`, id); err != nil {
				t.Errorf("cleanup activity %s: %v", id, err)
			}
		}
		if _, err := pool.Exec(bg, `DELETE FROM business.stores WHERE id = ANY($1)`, []string{storeMin, storeOther}); err != nil {
			t.Errorf("cleanup stores: %v", err)
		}
		if _, err := pool.Exec(bg, `DELETE FROM business.accounts WHERE id=$1`, biz); err != nil {
			t.Errorf("cleanup account: %v", err)
		}
		cleanupBusinessUsersPG(t, pool, []string{owner})
	})

	exec(`INSERT INTO business.accounts (id, owner_user_id, name, status, created_at) VALUES ($1,$2,'Attribution Co','ACTIVE',now())`, biz, owner)
	exec(`INSERT INTO business.stores (id, business_id, name, address, status, created_at, reality_scene_id) VALUES
		($1,$2,'Attr Store A','Addr','ACTIVE',now(),$4),
		($3,$2,'Attr Store B','Addr','ACTIVE',now(),$4)`, storeMin, biz, storeOther, claimedScene)

	repo := NewActivityRepository(pool)
	mustCreate := func(id, sceneID string) {
		if err := repo.Create(ctx, activity.Activity{
			ID: id, Origin: "TEST", Status: "PUBLISHED", Title: "归因局 " + id,
			Time: "周六 15:00", Capacity: 10, VenueType: "CAFE", RealitySceneID: sceneID,
		}); err != nil {
			t.Fatalf("create %s: %v", id, err)
		}
	}
	mustCreate(actClaimed, claimedScene)
	mustCreate(actUnclaimed, unclaimedScene)

	// 下完一单把该行的 store_id 原样读回来：NULL 必须是真的 NULL（**string == nil），
	// 不是空串 —— 两者的区别在统计口径里是「没归因」与「归到了空店」。
	storeIDOf := func(activityID, actor string) *string {
		t.Helper()
		if _, _, err := repo.Join(ctx, activityID, actor, activity.JoinRecipe{}); err != nil {
			t.Fatalf("join %s: %v", activityID, err)
		}
		var storeID *string
		if err := pool.QueryRow(ctx,
			`SELECT store_id FROM activity.participants
			 WHERE activity_id=$1 AND actor_id=$2 AND companion_id=''`, activityID, actor).Scan(&storeID); err != nil {
			t.Fatalf("读 %s 的 store_id: %v", activityID, err)
		}
		return storeID
	}

	claimed := storeIDOf(actClaimed, "user_attrib_book_"+run)
	if claimed == nil {
		t.Fatalf("场景 %s 被 %s 认领了，报名单却没记 store_id（这一列建了但没写 = 控制台按店数单仍然是 0）", claimedScene, storeMin)
	}
	if *claimed != storeMin {
		t.Fatalf("同场景两家认领时必须取 id 最小的那个（ORDER BY id LIMIT 1）：得到 %q，期望 %q", *claimed, storeMin)
	}

	unclaimed := storeIDOf(actUnclaimed, "user_attrib_book_"+run)
	if unclaimed != nil {
		t.Fatalf("场景 %s 没有任何门店认领，store_id 必须是 NULL 而不是猜一个：得到 %q", unclaimedScene, *unclaimed)
	}
}
