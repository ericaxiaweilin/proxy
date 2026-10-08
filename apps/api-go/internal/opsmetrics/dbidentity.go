package opsmetrics

import (
	"context"
	"fmt"
)

// DBIdentity 是「这台进程正在读哪一个库」的可核对答案（OPS-DATA-ENV-001 的另一半）。
//
// 声明 PROXY_OPERATOR_DATA_ENV=production 是一句**断言**；界面上光有断言，运营仍然只能选择
// 相信它。这一条把断言变成可核对的事实：库名、服务端地址、端口 —— 运营拿它跟部署清单对一眼
// 就知道自己看的是哪套数据。这也是这个后台一直缺的东西：本机 dev 库和服务器上的库都叫
// proxy，页面上一模一样，出了「拿 A 库的数回答 B 库的问题」没有任何线索。
//
// 只从服务端问出来的目录函数取值，**不碰连接串**：DATABASE_URL 里有用户名和密码，
// 把它拆开打印到控制台，就等于把凭据贴在一个会截图、会进录屏、会进日志的界面上。
type DBIdentity struct {
	Database string `json:"database"`
	Host     string `json:"host"`
	Port     int64  `json:"port"`
	Version  string `json:"version"`
}

// String 是给说明文字用的短形：dbname@host:port。
func (d DBIdentity) String() string {
	if d.Database == "" {
		return "未知库"
	}
	return fmt.Sprintf("%s@%s:%d", d.Database, d.Host, d.Port)
}

// DBIdentity 问的是服务端本身，不是缓存的连接参数 —— 连的是哪个库以服务端回答为准。
func (p *Postgres) DBIdentity(ctx context.Context) (DBIdentity, error) {
	var out DBIdentity
	err := p.pool.QueryRow(ctx, `
		SELECT current_database(),
		       -- host() 取地址本身；直接 ::text 会带上掩码，本机实测印成 proxy@::1/128:5432，
		       -- 运营拿它没法跟部署清单比。
		       coalesce(host(inet_server_addr()), '(local socket)'),
		       coalesce(inet_server_port(), 0),
		       current_setting('server_version')`).
		Scan(&out.Database, &out.Host, &out.Port, &out.Version)
	if err != nil {
		return DBIdentity{}, err
	}
	return out, nil
}
