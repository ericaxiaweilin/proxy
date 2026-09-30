# LaunchAgents（本目录的副本）

这里是 `~/Library/LaunchAgents/` 下**本项目**用到的 plist 的仓库副本，方便随代码
一起 review 与删除。真正生效的那份在 `~/Library/LaunchAgents/`，改这里不会生效 ——
改完要复制过去再 `launchctl bootout` + `bootstrap`。

| plist | 作用 | 备注 |
|---|---|---|
| `com.user.proxy-dev-feed-pipeline.plist` | 开发用 feed 管线，每 5 分钟一条帖文 | DEV-ONLY。「后期删除」时删这个 + `scripts/dev-feed-pipeline.mjs` 即可 |

## 安装 / 卸载

```bash
# 装
cp scripts/launchagents/com.user.proxy-dev-feed-pipeline.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.user.proxy-dev-feed-pipeline.plist

# 卸（后期删除走这条）
launchctl bootout gui/$(id -u)/com.user.proxy-dev-feed-pipeline
rm ~/Library/LaunchAgents/com.user.proxy-dev-feed-pipeline.plist
```

## 目录里为什么**没有** dev-api / dev-metro

`com.user.kake-dev-api` / `com.user.kake-dev-metro` 是产品基线的常驻服务，属于长期
设施；它们的名字虽然还叫 kake（脚本内部的 REPO 已指向 `~/proxy`），但那是**真实
生效的标签** —— 把它们"整理"成 proxy 名字会让文档和 `launchctl kickstart` 指不到
真东西。等真的要改名时，连同 `~/bin/kake-dev-*.sh` 和所有引用一起改，并同步更新
`docs/development/SOP_DYNAMIC_IP_DEVICES.md`。
