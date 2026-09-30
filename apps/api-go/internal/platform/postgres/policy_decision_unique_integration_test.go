package postgres

import (
	"context"
	"strings"
	"testing"
)

// POLICY-DECISION-UNIQUE-001（migrations/150）：`policy.policy_decisions` 上必须**恰好一条**
// 唯一约束，而且是**带 jurisdiction** 的那条。
//
// 背景（2026-09-30 实测，由 scripts/p1e-jurisdiction-e2e.sh 第 8 步暴露）：
//
//	065 建了 UNIQUE (user_id, category_code, terms_version, privacy_version)。
//	PostgreSQL 自动起名会把标识符截断到 63 字符，实际名字是
//	  policy_decisions_user_id_category_code_terms_version_privac_key
//	067 以为它叫 policy_decisions_user_cat_terms_privacy_key，于是那句
//	  `IF EXISTS ... DROP CONSTRAINT` **静默跳过**了；同一支又把带 jurisdiction 的
//	  更宽约束 policy_decisions_user_cat_terms_privacy_jur_key 加了上去。
//	两条并存 ⇒ **更窄的那条说了算**（4 列的唯一天然蕴含 5 列的唯一）⇒ 同一个用户换了
//	辖区之后再下 PLATFORM_PAY，策略决策写不进去（SQLSTATE 23505）⇒ 那一单永远确认不了。
//
// 这条钉子守两件事：
//  1. **条数**：旧的窄约束不许被加回来（加回来 = 换辖区又下不了单）；
//  2. **内容**：jurisdiction 不许从约束里消失 —— 少了它，两个辖区会共用同一条决策，
//     那是合规问题，不只是功能问题。
func TestPolicyDecisionsUniqueConstraintIncludesJurisdictionPostgres(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	rows, err := pool.Query(ctx, `
		SELECT conname, pg_get_constraintdef(oid)
		FROM pg_constraint
		WHERE conrelid = 'policy.policy_decisions'::regclass AND contype = 'u'
		ORDER BY conname`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	type unique struct{ name, def string }
	found := []unique{}
	for rows.Next() {
		var u unique
		if err := rows.Scan(&u.name, &u.def); err != nil {
			t.Fatal(err)
		}
		found = append(found, u)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	if len(found) != 1 {
		names := make([]string, 0, len(found))
		for _, u := range found {
			names = append(names, u.name+" ("+u.def+")")
		}
		t.Fatalf("policy.policy_decisions must have exactly 1 unique constraint, found %d: %s\n"+
			"一条更窄的旧约束会挡住「换辖区后的第二条 PLATFORM_PAY 单」—— 见 migrations/150",
			len(found), strings.Join(names, "; "))
	}
	if !strings.Contains(found[0].def, "jurisdiction") {
		t.Fatalf("the surviving unique constraint %q must include jurisdiction, got %s\n"+
			"少了它，不同辖区会共用同一条策略决策（合规问题）", found[0].name, found[0].def)
	}
}
