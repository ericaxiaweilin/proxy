# Laya 决策引擎 × 撮合交易引擎：能用的部分（详细设计）

- 状态：调研结论 + 落地设计（待评审，未开工）
- Laya 版本基线：v0.3.20，Apache-2.0，[NandhaKishorM/laya](https://github.com/NandhaKishorM/laya)（23.5k stars）
- 我们的引擎现状：demand → matching → supply → fulfillment → marketplace，见代码 `apps/api-go/internal/{marketplace,fulfillment,supply,demand}`

## 1. 一句话结论

Laya 能吃掉我们引擎里所有的**文本理解 + pairwise 打分**类决策（机会分类、举报分流、供需 fit 打分）；
**集合上的决策**（N 选一、排序、定价、容量）它做不了，继续用我们的规则 + 量化特征。
拼法：`match = 文本 fit（Laya） × 行为分（我们）`，低置信一律走人工/默认路径（fail-closed 不变）。

## 2. Laya 是什么（只写核实过的）

- 非自回归 System-1 决策模型：一次前向同时回答多道 typed 问题（`choice` / `score` / `noul`），不生成文本，无幻觉解析负担。
- 三个 checkpoint：`laya`（英文，ModernBERT-large 421M，512 ctx）、`laya-multilingual`（100+ 语言，mmBERT 322M，1024 ctx，可到 8192）、`laya-typed-decisions`（类型化决策微调版）。
- Router 按 script/语言自动选 checkpoint；也可显式指定 `model=`。
- 延迟：GPU 单问题约 33ms、10 问 batch 约 72ms；CPU 193–464ms。`predict_batch` 打包同 schema 请求共享前向。
- 置信度是真概率（RLCD 严格真评分规则训练），**但**：出厂偏过自信；multilingual 没有拟合温度；**必须在自己数据上拟合 temperature + 验证阈值**，作者原话。
- 服务形态：`laya[serve]` 起 FastAPI（`POST /v1/systemone`，跟 Jev 同线协议），可 Docker/compose，可 MCP/LangChain。
- 已知坑（作者自述 + 实测逻辑）：
  1. 短拉丁文本语言检测弱 —— **越南语就是拉丁文本**，"Cà phê Hồ Tây"这种短串可能被扔进 English checkpoint 出垃圾。必须设 `default="multilingual"`，并在越南语料上验证。
  2. 选项预算：`head_max_len` 192/256 tokens，选项一多就截断（~20 个带描述的选项即危险）。候选一多先短名单（`predict_shortlist`）。
  3. 长文档 4000 tokens 以上准确率波动；短输入不受影响。
  4. 单作者 beta 项目（v0.3.x，52 issues 在途），中文媒体"快 8 倍"宣传别信。把它当"带置信度的分类器升级版"，决策权永远在我们手里。

## 3. 能用的三处（按价值排序）

### 3.1 机会分类（第一刀，影子跑两周）

- 现状：`inferOpportunityTypeForFilter` 纯关键词（walk/双语/活动…），不中就 `other`，自定义发布基本全掉进垃圾桶，稀释筛选。
- 改法：`choice` 问题，criteria = 六类（咖啡+拍照 / City Walk+拍照 / 咖啡+中文 / 看店+双语 / 活动+拍照 / 其他未分类），state = title + desc + skills + location。
- 零样本先上，capacity 到了用我们自己的机会语料 fine-tune（Kaggle 2xT4 notebook 作者给了现成链路）。
- 成功标准：影子跑两周，分类准率 > 关键词基线 15pt 以上，且 `other` 占比下降，再切 0.7 阈值（在我们数据上拟合）。

### 3.2 举报分流（COMP-REPORT-001 的 8 类）

- 现状： intake 后靠规则/人工看。Laya triage 预设就是干这个的。
- 改法：`choice`（8 类）+ `score`（紧急度）+ `noul`（需立即人工介入？），低置信进人工队头，高置信自动路由。
- 注意：只做**路由**，不做**判定**（封号/下架还是人工 + 现有流程）。

### 3.3 供需 fit 打分（行为量化 + 文本理解拼一起）

- 前提（已成立）：行为数据全部可量化 —— 满意率（FULL 占比）、复购意向（REUSE 去重）、完成单数、投诉数、响应时长。
- 改法：pairwise 打分，state 用 JSON 同时喂两边：
  ```json
  state = {"provider_completed": 42, "full_rate": 0.85, "complaints": 0,
           "repeat_intent_rate": 0.3, "avg_response_min": 12,
           "opportunity_text": "周末西湖摄影向导…", "provider_tags": "摄影/中文"}
  questions = {"fit": {"type": "score", "criteria": ["完全不对口", "能接", "非常对口"]}}
  ```
- 输出只是一个 0–2 的 fit 分，**不直接选人**。最终排序：
  `match = fit(Laya) × behavior(我们现有满意率/复购/分档)`，再叠金额场景分档与容量规则。
- 成功标准：离线评测（历史成交 pair 做回放）top-1 命中率高于纯规则基线；在线只做影子分，不参与排序，直到达标。

## 4. 明确不用的

- 最终排序选人（N 选一）：listwise + 约束（容量、冲突、去重）是匹配/优化问题，Laya 一次只判一个对象，架构不对。
- 定价/金额分档（ORDER-SCENARIO-001 的 ordinary/assistance + 金额档）：规则 +  confinement，稳定可解释，别碰。
- Feed 推荐：它不是推荐器；feed 刚切回时间序，别开倒车。
- KYC 通过/拒绝、封号等终局判定：永远人工。Laya 最多做**队列优先级**（urgency/risk score），排前面先审。

## 5. 架构（按我们的规矩来）

- 不直绑模型、不装 Python 依赖进 Go 服务。Laya 自托管 sidecar（`laya-serve`，内网端口，`LAYA_API_KEY` bearer），经 model platform 暴露成 task，客户端（App/业务服务）只提交 task intent：
  - `classify-opportunity {title, desc, skills, location}` → `{type, confidence}`
  - `triage-report {body, category_hints}` → `{route, urgency, needs_human, confidence}`
  - `score-pair-fit {provider_features, opportunity_text, provider_tags}` → `{fit, confidence}`
- Go 端只认 task 契约 + 置信度门限；阈值以下走现有老路径（关键词/人工队头/纯规则分），fail-closed。
- 越南语：sidecar 固定 `default="multilingual"`；`predict_shortlist` 先行于大候选集；CPU 延迟 200–460ms 的调用一律走异步/影子，不进同步下单链路。
- 可观测：每次调用记 `task, 置信度, 阈值动作（采用/转人工/回退）, 延迟`，进现有 metrics；影子期额外记"老逻辑答案 vs Laya 答案"对照表。

## 6. 数据与校准（必须做，不做等于裸奔）

1. 收集：机会语料（title/desc/skills/location + 人工复核 type ≥ 500 条）、举报语料（8 类各 ≥ 100 条）、成交 pair（provider 特征 + opportunity 文本 + 是否成交/满意）。
2. 拟合 temperature（multilingual 必做）+ 在 holdout 上选阈值（coverage/accuracy 曲线，错误要是"能接受的错"）。
3. 越南语短文本专项验证集（≤10 词的真实例子 ≥ 200 条），路由正确率 < 95% 就加规则前置（长度/关键词短名单），不硬上。
4. Fine-tune 只在零样本不达标时做（Kaggle 免费 T4 链路现成）。

## 7. Rollout

- P0 影子（2 周）：三处全量双跑，只记不判。出口指标：分类准率、路由准率、fit 与成交的相关性。
- P1 阈值切流：机会分类先切（影响面最小：分错类只影响筛选显示，不影响成交）；举报分流第二；fit 打分最后，且永远只做乘子，不做选人。
- P2 回滚线：任一指标连续 3 天低于基线，或 P99 延迟 > 800ms，秒回老路径（开关在 task 层，不用发版）。
- 成本：CPU sidecar 一台（影子期）→ 有量再上 T4；微调零成本（Kaggle）；主要成本是人工复核语料的工时。

## 8. 风险

- 单作者 beta：pin 版本 + vendor 镜像，sidecar 挂了 task 层自动回退老路径（healthcheck 熔断）。
- 中文媒体夸大：所有"快/准"数字以我们自己影子数据为准，不以官方 benchmark 为准。
- 数字进 BERT 是按 token 理解的：纯数字排序/比较别指望它，阈值附近行为必须实测（作者自己都提醒 mixed precision 下阈值漂移）。
