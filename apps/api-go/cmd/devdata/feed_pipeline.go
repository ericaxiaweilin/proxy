package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// feedPipeline is the port of scripts/dev-feed-pipeline.mjs: one plain-text post per
// tick (launchd runs it every five minutes), so the feed keeps having fresh content.
//
// FOR-YOU-CANDIDATES-001（2026-10-04）：不再每个 tick 新建一个用户。作者从已有的
// devpipe 用户里按帖子序号轮流取；一个都没有时才建第一个。以前每 5 分钟多一个
// "Dev N"，又都铺了 0km 的坐标，For You / 真人推荐「最近的 N 个」被它们占满。
//
// Why text-only: posting through the real API has to satisfy the media owner
// constraints — UpdateProfile's avatar must be owner-matched, moderation APPROVED and
// visibility PUBLIC (media/service.go ErrMediaNotOwner). Reusing the 30 creator
// portraits was refused with PROFILE_AVATAR_NOT_DELIVERABLE, and owner is owner: no
// amount of privilege-wiring changes that. A text post stays isomorphic to a real one
// without touching that constraint.
//
// Why SQL instead of CreatePost: the API path needs CreateAnonymousSession +
// UpdateProfile per tick, and every fresh idempotencyKey leaves another session row
// behind (one day measured 474 sessions and 6974 idempotency records). Producing feed
// content should not pollute the identity tables.
//
// The row shape was measured, not guessed: media_refs is NOT NULL and "no pictures"
// is JSON 'null' (the existing 47 rows do that), scene_type is a 9-value CHECK enum,
// city_scope uses the short forms (hn / hcm / danang / hue), visibility PUBLIC, status
// PUBLISHED, author_type USER.
//
// Handles carry a monotonic sequence suffix because identity.profiles has
// UNIQUE (lower(ltrim(handle,'@'))); avatars may repeat (rotated by sequence over the
// READY creator portraits), usernames may not.
func feedPipeline(ctx context.Context, pool *pgxpool.Pool, out io.Writer, args []string) error {
	dryRun := hasFlag(args, "--dry-run")
	ticks := 1
	if raw, found := flagValue(args, "--backfill"); found {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			return fmt.Errorf("--backfill 要一个正整数，收到的是 %q", raw)
		}
		ticks = parsed
	}

	suffix := ""
	if dryRun {
		suffix = "（dry-run）"
	}
	fmt.Fprintf(out, "=== dev feed pipeline · %d tick%s ===\n", ticks, suffix)

	start, err := nextPostSequence(ctx, pool)
	if err != nil {
		return err
	}
	authors, err := pipelineAuthors(ctx, pool)
	if err != nil {
		return err
	}

	created := 0
	for i := 0; i < ticks; i++ {
		seq := start + i
		var user pipelineUser
		if len(authors) == 0 {
			// 第一次跑、库里一个管线用户都没有：建一个当作者。
			if user, err = seedUser(ctx, pool, 1, dryRun); err != nil {
				return err
			}
			authors = append(authors, user.id)
		} else {
			user = pipelineUser{id: authors[seq%len(authors)], reused: true}
		}
		post, err := seedPost(ctx, pool, seq, user.id, dryRun)
		if err != nil {
			return err
		}
		tag := "已建用户"
		switch {
		case user.reused:
			tag = "作者"
		case dryRun:
			tag = "将建用户"
		}
		if post.body != "" { // seedPost 只在真的新发时填 body；已存在的序号按幂等跳过
			created++
		}
		avatar := user.avatar
		if avatar == "" {
			avatar = "—"
		}
		detail := ""
		if dryRun && post.body != "" {
			detail = " · " + post.body
		}
		fmt.Fprintf(out, "  [%d] %s %s（%s） · 帖 %s%s\n", seq, tag, user.id, avatar, post.id, detail)
	}

	// Nothing new has to say so: "the pipeline ran" is not "the pipeline posted".
	if !dryRun && created == 0 {
		fmt.Fprintln(out, "  （本轮没有新增 —— 序号已存在，按幂等跳过）")
	}
	if dryRun {
		fmt.Fprintln(out, "\n（dry-run，未写库）")
		return nil
	}

	// Post ids carry the `post_` prefix (seedPost writes `post_devpipe_<seq>`), so the
	// tally must LIKE on `post_devpipe_%` — counting `devpipe_%` here returned 0 while
	// the database held hundreds.
	var postCount, userCount int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM localnet.posts WHERE id LIKE $1`, "post_"+feedHandlePrefix+`_%`).Scan(&postCount); err != nil {
		return fmt.Errorf("count pipeline posts: %w", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM identity.user_accounts WHERE id LIKE $1`, feedHandlePrefix+`_%`).Scan(&userCount); err != nil {
		return fmt.Errorf("count pipeline users: %w", err)
	}
	fmt.Fprintf(out, "\n  管线累计：%d 用户 / %d 帖\n", userCount, postCount)

	// 距离分层（只铺 devseed 的坐标）每个 tick 顺手复核一次：新跑的 seed_dev_shops_users
	// 加进来的 devseed 用户没有坐标就筛不到（PERSON-DISTANCE-ZERO-001）。失败不中断这个
	// tick：帖子已经发出去了，坐标下一轮再铺。
	tierReport := &bytes.Buffer{}
	if err := distanceTiers(ctx, pool, tierReport, nil); err != nil {
		fmt.Fprintf(os.Stderr, "  WARN: 铺距离坐标失败（不影响已发出的帖）：%s\n", err)
	} else if verdict := lineContaining(tierReport.String(), "分层完整"); verdict != "" {
		fmt.Fprintf(out, "  距离分层：%s\n", verdict)
	}

	// 排期跟着一起滚。理由和距离分层一样：dev 窗口是贴 now() 按偏移写的，最近的
	// `_noon` 段只活到 now+3h —— 不每个 tick 滚，"此刻谁有空"就会在几小时内退化成
	// 全员未知；把它留成"要人记得单独跑的命令"，就是 383 段过期、报告一直红那个样子。
	availReport := &bytes.Buffer{}
	if err := seedAvailabilityWindows(ctx, pool, availReport); err != nil {
		fmt.Fprintf(os.Stderr, "  WARN: 滚动排期失败（不影响已发出的帖）：%s\n", err)
	} else {
		var expiredAfter int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM supply.availability_windows
			 WHERE status = 'AVAILABLE' AND end_at <= now()`).Scan(&expiredAfter); err != nil {
			return fmt.Errorf("count expired windows after rolling: %w", err)
		}
		written := strings.TrimSpace(availReport.String())
		if line, _, found := strings.Cut(written, "\n"); found {
			written = line
		}
		fmt.Fprintf(out, "  排期：%s · 过期 %d 段\n", written, expiredAfter)
	}

	// The UNIQUE index makes a collision impossible at insert time, but saying it here
	// is what a reader of this output came looking for.
	var duplicateHandles int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM (
		  SELECT lower(ltrim(handle, '@')) AS h FROM identity.profiles
		   WHERE user_account_id LIKE $1
		   GROUP BY 1 HAVING count(*) > 1) x`, feedHandlePrefix+`_%`).Scan(&duplicateHandles); err != nil {
		return fmt.Errorf("count duplicate handles: %w", err)
	}
	if duplicateHandles > 0 {
		return fmt.Errorf("有 %d 组重复句柄 —— 用户名必须唯一", duplicateHandles)
	}
	fmt.Fprintln(out, "  句柄唯一：通过")
	return nil
}

const feedHandlePrefix = "devpipe"

func lineContaining(text, needle string) string {
	for _, line := range strings.Split(text, "\n") {
		if strings.Contains(line, needle) {
			return strings.TrimSpace(line)
		}
	}
	return ""
}

// postBodies are short Vietnamese posts close to the length and tone of real feed
// content, each pinned to a city_scope short form and one of the nine scene_type
// values the CHECK enum allows.
var postBodies = []struct {
	body      string
	cityScope string
	sceneType string
}{
	{"Sáng nay quán vắng, ngồi được hai tiếng không ai hỏi gì. Tối nay chắc lại đông.", "hn", "COFFEE"},
	{"Hết mùa mưa rồi. Đường ngoài phố cổ khô trơn, đi bộ dễ thấy.", "hn", "OUTDOOR"},
	{"Quán mới thử, cà phê hơi nhạt. Giá thì vừa, view thì quá trời đẹp.", "hcm", "COFFEE"},
	{"Bánh mì ốp lò bán tới 9h, hết là hết. Hôm nay tôi đến trễ mất bốn cái.", "hcm", "BRUNCH"},
	{"Nhạc cũ nghe đỡ mệt hơn nhạc mới. Quán nào cũng vậy.", "hcm", "NIGHTLIFE"},
	{"Cà phê sữa đá, nhiều đá. Nhức răng nhưng không bỏ được.", "danang", "COFFEE"},
	{"Trưa nay nắng gắt, ngồi trong nhà mà vẫn nóng. Ăn bún chả rồi về.", "hue", "BRUNCH"},
	{"Có quán nào ở đây cho tôi chỗ có ổ cắm không. Đã ngồi hai tiếng mới hết pin.", "hn", "COFFEE"},
	{"Đi bộ từ 5h sáng, chợ chưa đông. Gặp sương mù dày hơn hôm qua.", "hue", "OUTDOOR"},
	{"Quán này nhạc acoustic, nên nói chuyện nghe rõ. Ít ai thích, tôi thích.", "hcm", "NIGHTLIFE"},
	{"Bánh cuốn cuộn lại ăn không được, ngon thì có. Tự quấn thì xịn hơn.", "hn", "BRUNCH"},
	{"Trà đá mát lạnh mùa này. Uống một ly là thấy cả ngày bớt nóng.", "hcm", "COFFEE"},
	{"Khuya nay vắng, chỉ có mình với con chó của quán.", "danang", "OUTDOOR"},
	{"Giao diện app mới nhìn sáng hơn hẳn. Đọc dễ hơn hẳn.", "hcm", "COFFEE"},
}

var pipelineCities = []string{"Hà Nội", "TP. Hồ Chí Minh", "Đà Nẵng", "Huế"}

// nextPostSequence reads the highest existing post_devpipe_ suffix. Posts carry their
// own sequence now that a tick no longer creates a user (FOR-YOU-CANDIDATES-001).
func nextPostSequence(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	var current int
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(substring(id from '[0-9]+$')::int), 0)
		  FROM localnet.posts WHERE id LIKE $1`, "post_"+feedHandlePrefix+`_%`).Scan(&current); err != nil {
		return 0, fmt.Errorf("read the next pipeline post sequence: %w", err)
	}
	return current + 1, nil
}

// pipelineAuthors lists the existing devpipe users, the authors a tick rotates over.
func pipelineAuthors(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT user_account_id FROM identity.profiles
		 WHERE user_account_id LIKE $1
		 ORDER BY substring(user_account_id from '[0-9]+$')::int`, feedHandlePrefix+`_%`)
	if err != nil {
		return nil, fmt.Errorf("list pipeline authors: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan pipeline author: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

type pipelineUser struct {
	id     string
	avatar string
	handle string
	reused bool
}

type pipelinePost struct {
	id   string
	body string
}

func seedUser(ctx context.Context, pool *pgxpool.Pool, seq int, dryRun bool) (pipelineUser, error) {
	uid := fmt.Sprintf("%s_%d", feedHandlePrefix, seq)
	user := pipelineUser{id: uid, handle: "@" + uid}

	var existing int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM identity.user_accounts WHERE id = $1`, uid).Scan(&existing); err != nil {
		return user, fmt.Errorf("look up pipeline user %s: %w", uid, err)
	}
	if existing != 0 {
		user.reused = true
		return user, nil
	}

	avatar, err := avatarForSequence(ctx, pool, seq)
	if err != nil {
		return user, err
	}
	user.avatar = avatar
	if dryRun {
		return user, nil
	}

	// Both rows or neither: an account id without its profile row is an orphan the
	// read model cannot render.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return user, fmt.Errorf("begin pipeline user: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		INSERT INTO identity.user_accounts (id, status, created_at, updated_at)
		VALUES ($1, 'ACTIVE', now(), now())`, uid); err != nil {
		return user, fmt.Errorf("create pipeline account %s: %w", uid, err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO identity.profiles
		  (user_account_id, name, handle, bio, city, avatar_path, version, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, 1, now())`,
		uid, fmt.Sprintf("Dev %d", seq), user.handle, "Tài khoản phát triển",
		pipelineCities[seq%len(pipelineCities)], avatar); err != nil {
		return user, fmt.Errorf("create pipeline profile %s: %w", uid, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return user, fmt.Errorf("commit pipeline user %s: %w", uid, err)
	}
	return user, nil
}

// avatarForSequence rotates the READY creator portraits that actually exist in the
// database. Reusing one real asset per dev account is allowed; pointing avatar_path at
// a nonexistent asset is how thirty broken images appear.
func avatarForSequence(ctx context.Context, pool *pgxpool.Pool, seq int) (string, error) {
	rows, err := pool.Query(ctx, `
		SELECT media_asset_id FROM media.media_assets
		 WHERE original_storage_key LIKE '%creator%portrait%' AND processing_status = 'READY'
		 ORDER BY media_asset_id`)
	if err != nil {
		return "", fmt.Errorf("list creator portraits: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return "", fmt.Errorf("scan creator portrait: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("read creator portraits: %w", err)
	}
	if len(ids) == 0 {
		return "", fmt.Errorf("库里没有 READY 的 creator 肖像，头像无从轮转")
	}
	return "assets/" + ids[seq%len(ids)], nil
}

func seedPost(ctx context.Context, pool *pgxpool.Pool, seq int, uid string, dryRun bool) (pipelinePost, error) {
	pid := fmt.Sprintf("post_%s_%d", feedHandlePrefix, seq)
	post := pipelinePost{id: pid}

	var existing int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM localnet.posts WHERE id = $1`, pid).Scan(&existing); err != nil {
		return post, fmt.Errorf("look up pipeline post %s: %w", pid, err)
	}
	if existing != 0 {
		return post, nil
	}

	content := postBodies[seq%len(postBodies)]
	post.body = content.body
	if dryRun {
		return post, nil
	}

	var displayName string
	if err := pool.QueryRow(ctx,
		`SELECT name FROM identity.profiles WHERE user_account_id = $1`, uid).Scan(&displayName); err != nil && err != pgx.ErrNoRows {
		return post, fmt.Errorf("read author name for %s: %w", uid, err)
	}
	if displayName == "" {
		// The author label is a display string, not a key. An empty profile name
		// renders as a blank card, so the Node version fell back to the sequence.
		displayName = fmt.Sprintf(" %d", seq)
	}

	// created_at is now(), so a tick every five minutes lands at the head of the
	// keyset index (idx_posts_feed_keyset sorts created_at DESC).
	if _, err := pool.Exec(ctx, `
		INSERT INTO localnet.posts
		  (id, author_type, author_id, author_display_name, body, media_refs,
		   visibility, city_scope, scene_type, status, context_refs, created_at, ephemeral_until)
		VALUES ($1, 'USER', $2, $3, $4, 'null'::jsonb,
		        'PUBLIC', $5, $6, 'PUBLISHED', '[]'::jsonb, now(), NULL)`,
		pid, uid, displayName, content.body, content.cityScope, content.sceneType); err != nil {
		return post, fmt.Errorf("create pipeline post %s: %w", pid, err)
	}
	return post, nil
}
