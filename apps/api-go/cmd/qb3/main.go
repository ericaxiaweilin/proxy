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
    rows, _ := conn.Query(ctx, `SELECT p.id, p.author_id, u.display_name, u.username, p.body, p.context_refs::text, p.created_at FROM posts p LEFT JOIN users u ON u.id=p.author_id WHERE u.display_name ILIKE '%bonsai%' OR u.username ILIKE '%bonsai%'`)
    defer rows.Close()
    fmt.Printf("Bonsai posts:\n")
    count := 0
    for rows.Next() {
        count++
        var id, author_id, name, username, body, ctxrefs, created string
        rows.Scan(&id, &author_id, &name, &username, &body, &ctxrefs, &created)
        fmt.Printf("  #%d post=%s author=%s name=%s body=%s created=%s\n", count, id, author_id, name, body, created)
    }
    if count == 0 {
        fmt.Printf("(no bonsai users found)\n")
    }
    // 找所有 MERCHANT user
    fmt.Printf("\nAll users:\n")
    rows2, _ := conn.Query(ctx, `SELECT count(*) FROM users`)
    var cnt int
    rows2.Next()
    rows2.Scan(&cnt)
    fmt.Printf("  count: %d\n", cnt)
    rows2.Close()
    rows2, _ = conn.Query(ctx, `SELECT count(*) FROM posts`)
    rows2.Next()
    rows2.Scan(&cnt)
    fmt.Printf("  posts count: %d\n", cnt)
    defer rows2.Close()
    for rows2.Next() {
        var id, name, username, at string
        rows2.Scan(&id, &name, &username, &at)
        fmt.Printf("  %s | %s | %s | %s\n", id, name, username, at)
    }
}
