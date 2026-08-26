package main
import (
  "context"
  "fmt"
  "github.com/jackc/pgx/v5"
)
func main() {
  ctx := context.Background()
  conn, _ := pgx.Connect(ctx, "postgres://proxy:proxy@127.0.0.1:5432/proxy?sslmode=disable")
  defer conn.Close(ctx)
  // 找 Bonsaidon 帖的 media_refs
  rows, _ := conn.Query(ctx, `SELECT id, body, media_refs, author_id, author_type, context_refs FROM localnet.posts WHERE id='post_86ee49af7e1a89f5694951e3'`)
  defer rows.Close()
  for rows.Next() { var id, b, r, ai, at, cr *string; rows.Scan(&id, &b, &r, &ai, &at, &cr); fmt.Printf("post=%s\n  body=%s\n  refs=%s\n  ai=%s at=%s\n  ctx=%s\n", deref(id), deref(b), deref(r), deref(ai), deref(at), deref(cr)) }
  // 找 seed_media_opening_video
  fmt.Println("---")
  rows2, _ := conn.Query(ctx, `SELECT media_asset_id, media_type, width, height, COALESCE(playback_url, ''), COALESCE(thumbnail_url, ''), processing_status, moderation_status FROM media.media_assets WHERE media_asset_id='seed_media_opening_video'`)
  defer rows2.Close()
  for rows2.Next() { var m, mt, p, t, ps, ms *string; var w, h *int; rows2.Scan(&m, &mt, &w, &h, &p, &t, &ps, &ms); fmt.Printf("media=%s %s %dx%d ps=%s ms=%s\n  play=%s\n  thumb=%s\n", deref(m), deref(mt), derefI(w), derefI(h), deref(ps), deref(ms), deref(p), deref(t)) }
}
func deref(s *string) string { if s == nil { return "" }; return *s }
func derefI(i *int) int { if i == nil { return 0 }; return *i }
