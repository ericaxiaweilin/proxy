# LaunchAgents（本目录的副本）

这里是 `~/Library/LaunchAgents/` 下**本项目**用到的 plist 的仓库副本，方便随代码
一起 review 与删除。真正生效的那份在 `~/Library/LaunchAgents/`，改这里不会生效 ——
改完要复制过去再 `launchctl bootout` + `bootstrap`。

## 一条规则：一个常驻服务只有一条启动路径

每台常驻服务都是同一个形状，没有第二条：

```
launchd (com.user.kake-dev-<svc>)
  → ~/bin/kake-dev-<svc>.sh     只管"在 launchd 下活下来"：清会话残留、单一 owner、
                                 端口占用回收，然后 exec ↓
  → scripts/dev-<svc>.sh        仓库里那条 blessed 入口：读 .env、拒绝缺 DATABASE_URL、
                                 exec go run ./cmd/<svc>
```

**手工起服务请走 `scripts/dev-<svc>.sh`**，不要自己 `go run ./cmd/...`：第二条启动
路径就是下一个"到底谁在跑、跑的是不是当前代码"。2026-10-03 就犯过一次 —— 为了赶
验证直接 `nohup go run ./cmd/worker`，结果本机有了第二条 worker，而它不属于任何
人管（会话结束就没了，下次没人记得它存在过）。

| plist | 作用 | blessed 入口 |
|---|---|---|
| `com.user.kake-dev-worker.plist` | outbox / 媒体处理 worker | `scripts/dev-worker.sh` |
| `com.user.proxy-dev-feed-pipeline.plist` | 开发用 feed 管线，每 5 分钟一条帖文（DEV-ONLY，后期可删） | `go -C apps/api-go run ./cmd/devdata feed-pipeline` |

## 安装 / 卸载

```bash
# 装
cp scripts/launchagents/com.user.kake-dev-worker.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.user.kake-dev-worker.plist

# 改完 plist 之后（改仓库这份不会生效，必须复制 + 重载）
cp scripts/launchagents/com.user.kake-dev-worker.plist ~/Library/LaunchAgents/
launchctl bootout gui/$(id -u)/com.user.kake-dev-worker
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.user.kake-dev-worker.plist

# 只重启（不换 plist）：代码改了要让它吃到
launchctl kickstart -k gui/$(id -u)/com.user.kake-dev-worker

# 卸
launchctl bootout gui/$(id -u)/com.user.kake-dev-worker
rm ~/Library/LaunchAgents/com.user.kake-dev-worker.plist
```

日志在 `~/Library/Logs/kake/dev-worker.log` / `.err.log`（worker 的处理日志走 stderr）。

## 还没收干净的两处不一致（下次一起收）

1. **`com.user.kake-dev-api` / `-metro` 的 plist 不在本目录**，只在
   `~/Library/LaunchAgents/`。worker 这份开始进仓库了，所以现在是"一半在服务族
   进仓库、一半没有"。要收敛的方向：三份 plist 都在本目录，机器上那份只是副本。
2. **`~/bin/kake-dev-*.sh` 不在版本库里**，而 plist 依赖它 —— 换一台机器照这份
   README 装不起来。要么把它们也收进 `scripts/launchagents/bin/` 并让 plist 指过去，
   要么在 README 里承认"这几行脚本是机器本地的"。现在两者都不是，先记在这儿。

`kake-` 前缀仍然保留：那是**真实生效的标签**（脚本内部 REPO 早已指向 `~/proxy`），
把它们"整理"成 proxy 名字会让文档和 `launchctl kickstart` 指不到真东西。真要改名，
就连 `~/bin/kake-dev-*.sh`、所有引用和 `docs/development/SOP_DYNAMIC_IP_DEVICES.md`
一起改。
