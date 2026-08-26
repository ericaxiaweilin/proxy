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
    // 找 VIDEO 端到端验证 caption
    rows, _ := conn.Query(ctx, `SELECT id, body, media_refs, author_id, author_type, context_refs FROM localnet.posts WHERE body LIKE '%VIDEO%' OR body LIKE '%端到端%'`)
    defer rows.Close()
    for rows.Next() { var id, b, r, ai, at, cr *string; rows.Scan(&id, &b, &r, &ai, &at, &cr); fmt.Printf("post=%s\n  body=%s\n  refs=%s\n  ai=%s at=%s\n  ctx=%s\n", deref(id), deref(b), deref(r), deref(ai), deref(at), deref(cr)) }
}
func deref(s *string) string { if s == nil { return "" }; return *s }
