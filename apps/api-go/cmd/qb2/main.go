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
    rows, _ := conn.Query(ctx, `SELECT id, display_name, username, author_type FROM users WHERE display_name ILIKE '%bonsai%' OR display_name ILIKE '%brand%' OR display_name ILIKE '%摄影%' OR username ILIKE '%bonsai%'`)
    defer rows.Close()
    for rows.Next() {
        var id, name, username, body, created string
        rows.Scan(&id, &name, &username, &body, &created)
        fmt.Printf("post=%s name=%s body=%s created=%s\n", id, name, body, created)
    }
}
