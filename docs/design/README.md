# Proxy UI 设计基线入口

本目录是 UI 更新的唯一导航入口。开发前先读本页，不再按根目录文件名或下载时间猜测版本。

## 当前生效基线

优先级从高到低：

1. 全局规范：[`../../Proxy_App_Design_System_R3.md`](../../Proxy_App_Design_System_R3.md)
2. 全局视觉样张：[`../../Proxy_App_Design_System_R3_Visual.html`](../../Proxy_App_Design_System_R3_Visual.html)
3. App 图标代码注册表：[`../../apps/mobile/src/components/proxy-icon.tsx`](../../apps/mobile/src/components/proxy-icon.tsx)
4. 页面级已审批参考：[`references/`](./references/)
5. 历史原型：[`archive/`](./archive/)（只能追溯，不能覆盖当前基线）

机器可读状态见 [`CURRENT_BASELINE.json`](./CURRENT_BASELINE.json)。

## 当前页面参考

| 范围 | 版本 | 文件 | 状态 |
|---|---|---|---|
| 商家「我的」 | R21 Activity Voucher Icon Fix | [`references/Proxy_Merchant_Me_Standalone_R21_ActivityVoucherIcon_Fix.html`](./references/Proxy_Merchant_Me_Standalone_R21_ActivityVoucherIcon_Fix.html) | 当前页面参考；不得覆盖 R3 全局 Logo、字体、颜色和图标规则 |
| 商家 Creator 经营 | Creator Center Match v3 | [`references/proxy_creator_center_match_v3.html`](./references/proxy_creator_center_match_v3.html) | 仅作为功能、字段和流程参考；UI/UX 必须沿用当前 R3 与商家模块 |
| 个人 Creator 申请 | Creator Apply v1 | [`references/proxy_creator_apply_v1.html`](./references/proxy_creator_apply_v1.html) | 仅作为申请流程与审核边界参考；UI/UX 使用当前 R3 |

## 历史资料规则

- `archive/prototypes/`：旧交互/页面原型，只用于查历史行为。
- `archive/icon-masters/`：旧图标母版。R1 已停用，禁止复制回生产代码。
- `Proxy_App_Design_Tokens_R2.json` 仍是旧机器 Token，标记为 **Legacy**；发生冲突时以 R3 Markdown 和生产代码为准，后续应生成 R3 Token 后替换。
- 根目录 PRD 是系统/业务合同，不因为 UI 整理而删除或改写。

## 每次 UI 更新流程

1. 把新原型放入 `docs/design/references/`，文件名必须包含模块和版本，禁止 `preview (n).html`。
2. 更新本页“当前页面参考”以及 `CURRENT_BASELINE.json`。
3. 先核对 R3 的 Logo、Icon Registry、字号、颜色、间距和导航，再实现页面差异。
4. 图标只能修改 `apps/mobile/src/components/proxy-icon.tsx` 的稳定 token/path；禁止页面内临时画、Unicode 回退或自行换图。
5. 执行 `pnpm --filter @proxy/mobile typecheck` 和 `pnpm --filter @proxy/mobile test`。
6. Android 与 iPhone 真机分别检查安全区、动态字号、横向溢出、键盘和底部导航。

## 放行 Gate

- [ ] 使用当前页面参考，而非 `archive/`。
- [ ] 正式水獭 Logo 未重绘、未套额外底色、未改变比例。
- [ ] 模块 icon token 与生产注册表一致。
- [ ] 正文不小于 11pt，Bottom Nav 之外无 10pt 以下文本。
- [ ] 390×844 基线与真机安全区均无裁切。
- [ ] 页面功能已接线，不是仅有静态壳。
- [ ] 类型检查与测试通过。
