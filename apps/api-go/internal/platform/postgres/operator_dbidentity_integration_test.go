package postgres

// OPS-DATA-ENV-001：库身份这条 SQL 必须真的对库跑过。
//
// api 层那组测试用的是假 Source —— 它证明 handler 会把字段透出来、问不出来时会明说，
// 一个字都不证明 current_database() / inet_server_addr() / inet_server_port() 这组目录函数
// 能在这台 PG 上跑（列名写错、inet 类型转 text 的写法、inet_server_addr() 在 unix socket
// 上返回 NULL 需要 coalesce —— 都会在这里炸，而炸的方式是界面上一片空白）。

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/proxy-app/proxy-api/internal/opsmetrics"
)

func TestPostgresDatabaseIdentityNamesTheConnectedDatabase(t *testing.T) {
	pool := testPool(t)
	id, err := opsmetrics.NewPostgres(pool).DBIdentity(context.Background())
	if err != nil {
		t.Fatalf("DBIdentity: %v", err)
	}
	// helper 起的临时库叫 proxy；连到别的库（DATABASE_URL）时也必须非空。
	if id.Database == "" {
		t.Fatal("current_database() 给出空串")
	}
	if id.Host == "" {
		t.Fatal("主机为空 —— unix socket 也该被 coalesce 成一个可读的标记，而不是空字符串")
	}
	if id.Port <= 0 {
		t.Fatalf("端口 = %d，TCP 连接下 inet_server_port() 必须有值", id.Port)
	}
	if id.Version == "" {
		t.Fatal("server_version 为空")
	}
	short := id.String()
	if !strings.Contains(short, "@") || !strings.Contains(short, id.Database) {
		t.Fatalf("短形 = %q，应当是 dbname@host:port —— 运营拿它跟部署清单对一眼就能用", short)
	}
	// 这条是这个功能的边界本身：这一屏会被截图、会进录屏，所以序列化出来不许有连接串的形状。
	raw, err := json.Marshal(id)
	if err != nil {
		t.Fatal(err)
	}
	for _, banned := range []string{"://", "password", "sslmode"} {
		if strings.Contains(strings.ToLower(string(raw)), banned) {
			t.Fatalf("库身份里出现了 %q：%s —— 只许问服务端目录函数，不许把连接串拆开打印", banned, raw)
		}
	}
}
