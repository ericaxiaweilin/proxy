# Proxy PRD v1.1

## Chapter 40 — Decision Data / Model Risk / AI Governance

**文档类型**：Decision Data / Dataset / Feature / Model Risk / Bias / Drift / AI Usage / Human Oversight / Model Incident  
**状态**：ACTIVE — Decision Intelligence / AI Safety / Model Governance Readiness  
**依赖**：Chapter 23 Policy Defaults / Configuration Registry、Chapter 24 Account Security / Privacy / Consent / Data Lifecycle、Chapter 25 E2E Acceptance / Test Matrix / Invariant Gate、Chapter 34 Enterprise Compliance / Audit / Trust Center Governance、Chapter 37 Financial Controls / Internal Audit / Risk Appetite / Board Governance、Chapter 38 Regulatory Change / Policy Migration / Market Re-Approval Governance、Chapter 39 Policy-as-Code / Runtime Decision / Explainability Governance  
**后续**：Chapter 41 AI-assisted Operations / Agentic Workflow / Delegated Action Governance

---

# 0. 本章目标

Proxy 的 Ranking、Pricing、Matching、Fraud、Risk、Support、Forecast、Revenue、Capacity 和 Policy runtime 可能使用统计模型、机器学习模型、规则模型、第三方模型或生成式 AI。本章把这些模型依赖的数据与治理边界收口。

本章必须明确：

- 哪些 DataAsset、Dataset、Feature、Label、Model、Prompt、Evaluation 和 Decision 可被使用；
- 数据来源、用途、同意、分类、保留、偏差、质量和 lineage 如何记录；
- Model 如何被训练、验证、批准、部署、监控、回滚和退役；
- Model Risk、Bias、Drift、Robustness、Privacy、Security、Vendor 和 Concentration 如何评估；
- AI / Model output 如何作为 Policy input、ranking signal、review suggestion 或 forecast，而不是 Domain truth；
- 哪些决策必须 human-in-the-loop、human-on-the-loop 或 human-only；
- 发生模型错误、数据泄露、系统漂移、错误拒绝、错误放行、解释缺失或 Vendor outage 时如何 contain 和恢复；
- 如何对用户、Enterprise、Operator、Auditor、Board 和 Regulator 提供安全、适当、可追溯的说明。

本章不做：

- 不让 ModelOutput 直接改写 UserAccount、KYC、Safety、Order、Payment、Payout、Invoice、Tax、Ledger 或 Contract；
- 不让模型分数自动变成 RiskDecision、KYC VERIFIED、Payout eligible、Payment success 或 Safety resolved；
- 不把训练集、评估集、日志、Prompt 或 embedding 当作可以无限使用的原始数据；
- 不以“模型不透明”“供应商算法”作为拒绝解释、隐藏偏差或扩大数据访问的理由；
- 不允许 AI 直接执行不可逆资金、身份、安全、隐私或合同动作；
- 不以准确率、AUC、NPS、收入或增长一个指标证明模型安全。

## 0.1 本章核心结论

```text
Data quality ≠ data permission
Feature ≠ fact
Model score ≠ Domain decision
Prediction ≠ verification
Correlation ≠ causation
Accuracy ≠ safety
Vendor assurance ≠ Proxy approval
Human review ≠ rubber stamp
AI explanation ≠ unrestricted chain-of-thought
Model rollback ≠ historical fact deletion
```

## 0.2 Model Use Tiers

| Tier | 用途 | 默认治理 |
|---|---|---|
| M0 | 非决策辅助、内部草稿、文案建议、低风险检索 | 仍需数据、隐私、审计边界 |
| M1 | Ranking、search、recommendation、forecast、support routing | offline test、drift、human escalation |
| M2 | Eligibility suggestion、fraud / risk triage、pricing guidance、resource allocation | model risk review、explainability、human / guardrail |
| M3 | 影响 KYC、Safety、Payment、Payout、Privacy、Contract、Account 或法律权利的决策 | 不允许 autonomous mutation；必须 Domain / human controlled |
| PROHIBITED | 直接执行不可逆资金、身份、Safety、隐私、Ledger 或绕过权限的 AI action | 禁止 |

---

# 1. AI / Model Governance Constitution

## 1.1 Canonical Domain Truth First

模型可以生成：

- score；
- probability；
- ranking feature；
- forecast；
- anomaly signal；
- classification；
- recommendation；
- draft explanation；
- review priority。

模型不能直接生成：

- `KYC_VERIFIED`；
- `SafetyIncident_RESOLVED`；
- `Payment_SUCCEEDED`；
- `FundingSecured`；
- `Payout_PAID`；
- `Ledger balance`；
- `Contract_ACCEPTED`；
- `Tax_FILED`；
- `UserAccount_CLOSED`；
- `Market_ACTIVE`。

这些状态必须由相应 Domain、authorized command、human review、provider result 或 legal / finance process 产生。

## 1.2 Purpose Limitation

数据能被模型使用必须同时满足：

```text
purpose
→ lawful / approved basis
→ scope
→ minimum necessary fields
→ allowed audience / model tier
→ retention
→ security
→ deletion / withdrawal behavior
```

“已经收集”不等于“可以训练”。“用于运营”不等于“可以用于自动拒绝”。

## 1.3 Model Risk Is Contextual

模型风险必须按 use case、Market、Entity、population、decision impact、human control 和 data class 评估。相同模型在 Ranking、KYC triage、Payout fraud 和 Board forecast 中的风险等级可以不同。

## 1.4 No Silent Model Change

以下变化必须有新版本和 change review：

- training dataset；
- label definition；
- feature logic；
- feature source；
- model code / weights；
- prompt / system instruction；
- retrieval corpus；
- threshold；
- calibration；
- fallback；
- vendor model version；
- human review policy；
- decision binding。

## 1.5 Model Output Uncertainty

每个 production output 必须能表达：

```text
score / prediction
confidence or uncertainty
model version
feature freshness
out-of-distribution signal
fallback / abstention
human review requirement
```

低 confidence、OOD、missing critical feature、vendor timeout 或 policy conflict 不得默认成为 allow / deny 的业务事实。

## 1.6 Human Accountability

Model owner 对模型负责，Domain owner 对业务状态负责，Risk / Compliance 对风险边界负责，Human reviewer 对人工 review 负责。AI 生成的建议不能成为“无人负责”的中间地带。

## 1.7 No Optimization Against Safety

不能为了提升：

- conversion；
- fill rate；
- revenue；
- margin；
- payout speed；
- support deflection；
- ranking engagement；

而降低 Safety、KYC、Privacy、Consent、Payment integrity、Ledger reconciliation、Tax 或 Audit controls。

---

# 2. Data / Dataset Domain Objects

## 2.1 DataAsset

```text
DataAsset
├── id
├── name
├── owner_ref
├── source_system
├── domain_owner
├── data_categories[]
├── classification: PUBLIC / INTERNAL / CONFIDENTIAL / RESTRICTED
├── D0_D5_level
├── purpose_refs[]
├── lawful_basis_refs[]
├── residency_refs[]
├── retention_policy_ref
├── consent_requirement
├── quality_profile_ref
├── access_policy_ref
├── lineage_refs[]
├── effective_from
├── effective_to?
├── status: DISCOVERED / APPROVED / ACTIVE / RESTRICTED / RETIRED
└── audit_ref
```

## 2.2 DataUseApproval

```text
DataUseApproval
├── id
├── data_asset_refs[]
├── purpose
├── use_type: TRAINING / INFERENCE / EVALUATION / MONITORING / DEBUG / EXPORT
├── model_or_system_refs[]
├── scope_ref
├── data_fields[]
├── lawful_basis / consent_ref
├── minimization_decision
├── retention_period
├── residency
├── prohibited_uses[]
├── approved_by[]
├── effective_from
├── effective_to?
└── status: DRAFT / REVIEW / APPROVED / ACTIVE / EXPIRED / REVOKED
```

## 2.3 Dataset

```text
Dataset
├── id
├── name
├── dataset_type: TRAIN / VALIDATION / TEST / CALIBRATION / REPLAY / MONITORING / SYNTHETIC
├── source_asset_refs[]
├── snapshot_ref
├── population_definition
├── inclusion_rules[]
├── exclusion_rules[]
├── time_window
├── market / entity scope
├── label_definition_ref?
├── feature_refs[]
├── DQ metrics
├── sensitive_attribute_handling
├── consent / lawful_basis_refs[]
├── split_method
├── leakage_checks[]
├── checksum
├── retention_policy_ref
├── owner_ref
├── status: DRAFT / APPROVED / FROZEN / ACTIVE / SUPERSEDED / DELETED
└── audit_ref
```

## 2.4 DatasetSnapshot

```text
DatasetSnapshot
├── id
├── dataset_ref
├── source_watermarks[]
├── record_count
├── feature_count
├── label_distribution
├── missingness_profile
├── duplicate_profile
├── outlier_profile
├── segment_counts[]
├── source_hash
├── generated_at
├── approved_at?
└── audit_ref
```

## 2.5 DatasetSplit

```text
DatasetSplit
├── id
├── dataset_ref
├── split_type: TRAIN / VALIDATION / TEST / CALIBRATION
├── selection_method
├── temporal_boundary
├── entity_separation_rule
├── leakage_controls[]
├── segment_coverage[]
├── snapshot_ref
├── status: DRAFT / FROZEN / APPROVED / INVALIDATED
└── audit_ref
```

## 2.6 LabelDefinition

```text
LabelDefinition
├── id
├── target_name
├── label_source_refs[]
├── observation_window
├── positive_definition
├── negative_definition
├── unknown_definition
├── censoring_rules[]
├── leakage_risk
├── human_review_requirement
├── version
├── owner_ref
└── status: DRAFT / ACTIVE / RETIRED
```

Label 不是天然事实。`Fraud`、`unsafe`、`quality`、`successful`、`good agent` 或 `likely to pay` 都必须说明来源、时间窗口、观察偏差和 appeal / correction path。

## 2.7 DataQualityProfile

```text
DataQualityProfile
├── id
├── data_asset_ref / dataset_ref
├── completeness
├── validity
├── accuracy_evidence
├── consistency
├── timeliness
├── uniqueness
├── representativeness
├── freshness_ttl
├── thresholds[]
├── breach_actions[]
├── generated_at
└── status: PASS / WARNING / FAIL / UNKNOWN
```

## 2.8 DataLineage

```text
DataLineage
├── id
├── source_refs[]
├── transformation_refs[]
├── dataset_refs[]
├── feature_refs[]
├── model_refs[]
├── output_refs[]
├── purpose
├── consent / legal basis refs[]
├── generated_at
├── version
└── audit_ref
```

## 2.9 DataSubjectRestriction

```text
DataSubjectRestriction
├── id
├── subject_ref
├── restriction_type: OPT_OUT / DELETE / CORRECT / DO_NOT_PROFILE / PURPOSE_REVOKED / LEGAL_HOLD / RESIDENCY_LIMIT
├── affected_asset_refs[]
├── affected_dataset_refs[]
├── affected_model_refs[]
├── effective_at
├── propagation_deadline
├── implementation_status
├── verification_evidence_refs[]
└── audit_ref
```

撤回、删除、纠正或 do-not-profile 必须评估：训练集、feature store、evaluation、inference cache、logs、embeddings、reports 和 vendor copy 的处理。

---

# 3. Feature / Representation Governance

## 3.1 FeatureDefinition

```text
FeatureDefinition
├── id
├── name
├── description
├── source_refs[]
├── transformation
├── unit / scale
├── freshness_ttl
├── point_in_time_rule
├── allowed_use_cases[]
├── prohibited_use_cases[]
├── data_classification
├── sensitive_or_proxy_flag
├── missing_behavior
├── owner_ref
├── version
├── status: DRAFT / APPROVED / ACTIVE / DEPRECATED / RETIRED
└── audit_ref
```

## 3.2 FeatureSnapshot

```text
FeatureSnapshot
├── id
├── feature_definition_refs[]
├── entity_scope
├── as_of_time
├── source_watermarks[]
├── value_hash
├── missingness
├── freshness
├── policy_binding_ref
├── model_use_ref
└── audit_ref
```

## 3.3 Point-in-time Correctness

Feature 在训练、评估、回放和线上推理中必须使用当时可获得的数据：

- 不能使用未来事件；
- 不能使用 outcome 后才产生的 status；
- 不能将人工 review 结论泄漏到预测之前；
- 不能把 future Payment / Payout / Incident 作为历史 feature；
- 不能用后来修正的 Ledger / Tax / KYC 结果假装当时已知。

## 3.4 Sensitive / Proxy Feature Review

Feature 必须标记：

- direct sensitive attribute；
- proxy risk；
- identity / demographic implication；
- location precision；
- financial sensitivity；
- health / safety sensitivity；
- derived from D4 / D5；
- use-case limitation。

禁止将 raw KYC、Government ID、精确 location、private chat、bank credential、protected attribute 或明显 proxy 直接用于未批准的 Ranking、Pricing、Eligibility、Fraud 或 Support priority。

## 3.5 Feature Store Boundary

Feature store 不是 Canonical Domain store。它必须支持：

- source ref；
- feature version；
- as-of time；
- TTL；
- deletion / correction propagation；
- access control；
- lineage；
- training / inference separation；
- audit。

## 3.6 Missing Feature Behavior

missing feature 必须显式处理：

```text
IMPUTE_WITH_APPROVED_RULE
ABSTAIN
ROUTE_TO_REVIEW
USE_SAFE_FALLBACK
DENY_HIGH_RISK_ACTION
```

不得用任意 zero、mean、false 或 empty string 把缺失伪装成真实值。

---

# 4. Model Lifecycle / Inventory

## 4.1 ModelRegistryEntry

```text
ModelRegistryEntry
├── id
├── name
├── model_type: RULE / STATISTICAL / ML / LLM / EMBEDDING / THIRD_PARTY / HYBRID
├── use_case
├── risk_tier: M0 / M1 / M2 / M3 / PROHIBITED
├── owner_ref
├── domain_owner_ref
├── intended_users
├── input_feature_refs[]
├── output_schema_ref
├── training_dataset_refs[]
├── evaluation_refs[]
├── policy_binding_refs[]
├── vendor_ref?
├── privacy_review_ref
├── security_review_ref
├── model_risk_review_ref
├── deployment_refs[]
├── status: PROPOSED / DEVELOPMENT / VALIDATED / APPROVED / ACTIVE / PAUSED / RETIRED / REVOKED
└── audit_ref
```

所有生产模型必须进入 registry。Notebook、临时脚本、外部 API、Prompt chain 或 Operator tool 也不能绕过 inventory。

## 4.2 ModelVersion

```text
ModelVersion
├── id
├── registry_entry_ref
├── artifact_ref
├── artifact_hash
├── code_version
├── dependency_lock
├── feature_version_set
├── label_definition_ref?
├── training_run_ref?
├── evaluation_refs[]
├── calibration_ref?
├── threshold_policy_ref?
├── explainability_method
├── limitations[]
├── created_at
├── approved_at?
├── effective_from?
├── effective_to?
├── status: DRAFT / TRAINED / VALIDATED / APPROVED / DEPLOYED / PAUSED / SUPERSEDED / RETIRED
└── audit_ref
```

## 4.3 ModelIntendedUse

```text
ModelIntendedUse
├── id
├── model_version_ref
├── use_case
├── allowed_decision_role: SIGNAL / RANKING / FORECAST / TRIAGE / RECOMMENDATION / DRAFT
├── prohibited_decision_roles[]
├── allowed_markets[]
├── allowed_entities[]
├── allowed_audiences[]
├── human_oversight_mode: NONE / ON_THE_LOOP / IN_THE_LOOP / HUMAN_ONLY
├── hard_guardrails[]
├── expiry
├── approval_refs[]
└── status: DRAFT / APPROVED / ACTIVE / SUSPENDED / RETIRED
```

## 4.4 ModelDependency

```text
ModelDependency
├── id
├── model_version_ref
├── dependency_type: DATA / FEATURE / POLICY / PROVIDER / LIBRARY / PROMPT / RETRIEVAL / HUMAN_REVIEW
├── dependency_ref
├── version
├── criticality
├── timeout / freshness
├── fallback
├── change_signal_refs[]
└── audit_ref
```

## 4.5 ModelRelease

```text
ModelRelease
├── id
├── model_version_ref
├── deployment_scope
├── environment
├── rollout_mode: SHADOW / CANARY / LIMITED / FULL / ROLLBACK
├── traffic_allocation
├── guardrail_refs[]
├── monitoring_refs[]
├── rollback_target_ref?
├── approval_refs[]
├── started_at
├── completed_at?
├── status: PLANNED / RUNNING / ACTIVE / PAUSED / ROLLED_BACK / COMPLETED / FAILED
└── audit_ref
```

## 4.6 PromptTemplate / RetrievalProfile

对于生成式 AI：

```text
PromptTemplate
├── id
├── purpose
├── system_instruction_hash
├── variable_schema
├── allowed_context_refs[]
├── prohibited_context_refs[]
├── output_schema
├── safety_rules[]
├── model_provider_ref
├── version
├── approval_refs[]
└── status: DRAFT / APPROVED / ACTIVE / RETIRED
```

```text
RetrievalProfile
├── id
├── corpus_refs[]
├── audience
├── authorization_filter
├── freshness_policy
├── citation_requirement
├── sensitive_data_filter
├── injection_defense
├── version
└── status: DRAFT / ACTIVE / PAUSED / RETIRED
```

LLM / RAG 输出必须有 source / citation、uncertainty、refusal / escalation path；不能把生成文本当作未经验证的事实。

---

# 5. Training / Evaluation / Validation

## 5.1 TrainingRun

```text
TrainingRun
├── id
├── model_registry_ref
├── source_dataset_refs[]
├── feature_version_set
├── label_definition_ref?
├── code_version
├── hyperparameters_summary
├── random_seed
├── compute_environment
├── output_model_version_ref
├── data_use_approvals[]
├── privacy_checks[]
├── leakage_checks[]
├── fairness_checks[]
├── started_at
├── completed_at?
├── status: PLANNED / RUNNING / COMPLETE / FAILED / INVALIDATED
└── audit_ref
```

## 5.2 ModelEvaluation

```text
ModelEvaluation
├── id
├── model_version_ref
├── dataset_ref
├── evaluation_type: OFFLINE / ONLINE / SHADOW / CANARY / FAIRNESS / ROBUSTNESS / PRIVACY / SECURITY / HUMAN_FACTORED
├── metrics[]
├── segment_metrics[]
├── calibration_metrics[]
├── error_analysis_refs[]
├── baseline_model_ref?
├── threshold_policy_ref?
├── limitations[]
├── evaluator_ref
├── evaluated_at
├── status: DRAFT / PASS / PASS_WITH_LIMITATION / FAIL / INCOMPLETE / SUPERSEDED
└── audit_ref
```

## 5.3 Metric Families

按 use case 选择 metric，不能用单一准确率：

- classification：precision、recall、FPR、FNR、calibration；
- ranking：NDCG、exposure、coverage、match quality；
- pricing：error、calibration、constraint violation；
- forecast：MAE、RMSE、interval coverage、bias；
- anomaly / fraud：precision at review capacity、false positive、loss avoided；
- LLM：groundedness、citation accuracy、refusal quality、toxicity、data leakage；
- safety / risk：miss rate、time to review、harm severity、abstention；
- operations：latency、availability、fallback rate、operator override；
- fairness：segment disparity、equalized error、access / exposure distribution。

## 5.4 Baseline Comparison

每次 ModelEvaluation 必须与：

- current production model；
- approved rule baseline；
- simple heuristic baseline；
- human reviewer baseline，如适用；

比较效果与风险。新模型更准确但增加 P0 false negative、隐私暴露或解释失败时，不得直接上线。

## 5.5 Threshold / Calibration

Threshold、calibration、abstention 和 review capacity 必须版本化。Threshold 不能只为提升业务 KPI 调高 / 调低而无 risk review。

## 5.6 Human Evaluation

Human evaluation 必须记录：

- reviewer training；
- blind / non-blind；
- rubric；
- sample；
- disagreement；
- inter-rater agreement；
- escalation；
- sensitive data handling；
- correction path。

人工标签也可能有偏差、利益冲突和疲劳，不能自动视为 ground truth。

## 5.7 Robustness Tests

至少测试：

- missing / malformed input；
- out-of-distribution；
- adversarial / prompt injection；
- duplicate / replay；
- provider timeout；
- stale feature；
- language / locale；
- market / entity shift；
- policy version mismatch；
- extreme / boundary amount；
- concurrent state change。

## 5.8 Privacy / Security Validation

模型验证必须检查：

- training data leakage；
- membership inference risk；
- prompt / retrieval data leakage；
- memorization；
- secret exfiltration；
- unauthorized cross-tenant retrieval；
- D4 / D5 exposure；
- deletion / opt-out propagation；
- model artifact access；
- vendor retention / reuse。

## 5.9 Evaluation Status

```text
PASS
    intended use / scope / metrics / limitations meet approval
PASS_WITH_LIMITATION
    safe use is bounded and limitations are explicit
FAIL
    material risk or required metric not met
INCOMPLETE
    data, segment, human, privacy, security or evidence coverage missing
```

`PASS_WITH_LIMITATION` 不能被 UI 缩写成“模型通过”。

---

# 6. Model Risk / Bias / Drift

## 6.1 ModelRiskAssessment

```text
ModelRiskAssessment
├── id
├── model_version_ref
├── intended_use_ref
├── scope_ref
├── risk_categories[]
├── inherent_risk
├── control_refs[]
├── evidence_refs[]
├── residual_risk
├── uncertainty
├── human_oversight
├── failure_modes[]
├── impact_assessment
├── risk_acceptance_ref?
├── assessor_ref
├── next_review_at
├── status: DRAFT / REVIEW / APPROVED / EXPIRED / REVOKED
└── audit_ref
```

## 6.2 FailureModeRecord

```text
FailureModeRecord
├── id
├── model_version_ref
├── failure_type: FALSE_ALLOW / FALSE_DENY / HALLUCINATION / DRIFT / LEAKAGE / BIAS / OOD / TIMEOUT / COST / MISROUTING / ACTION_MISMATCH
├── trigger
├── affected_population
├── severity
├── likelihood
├── detectability
├── impact
├── controls
├── mitigation
├── residual_risk
├── owner_ref
└── audit_ref
```

## 6.3 BiasAssessment

```text
BiasAssessment
├── id
├── model_version_ref
├── use_case
├── protected_or_sensitive_segments[]
├── proxy_analysis
├── metric_refs[]
├── sample_quality
├── observed_disparities[]
├── causal_limitations[]
├── mitigation_options[]
├── decision_impact
├── reviewer_refs[]
├── status: DRAFT / PASS / PASS_WITH_LIMITATION / FAIL / INCOMPLETE
└── audit_ref
```

## 6.4 Fairness Boundary

公平性 assessment 必须结合真实 use case：

- Ranking 看 exposure、opportunity、quality 和 safety；
- Pricing 看报价、费率、补偿和解释；
- Fraud 看 false positive、review burden 和 appeal；
- Support 看 routing、SLA 和 language access；
- Risk / KYC triage 看错误拒绝、等待时间和人工复核；
- Forecast 看 segment / market 的 systematic error。

不能为了“各群体完全相等”而违反 Safety、KYC、Consent、Legal、Payment 或真实 capability requirements。

## 6.5 DriftMonitor

```text
DriftMonitor
├── id
├── model_version_ref
├── feature_refs[]
├── reference_dataset_ref
├── live_window
├── metrics: PSI / KS / JS / MISSINGNESS / PERFORMANCE / LABEL_DELAY / SEGMENT_SHIFT
├── thresholds[]
├── alert_actions[]
├── owner_ref
├── status: ACTIVE / WARNING / BREACH / PAUSED / RETIRED
└── audit_ref
```

## 6.6 Drift Types

```text
DATA_DRIFT
CONCEPT_DRIFT
LABEL_DRIFT
PERFORMANCE_DRIFT
SEGMENT_DRIFT
POLICY_DRIFT
PROVIDER_DRIFT
ENVIRONMENT_DRIFT
```

不同 drift 需要不同 response，不能只重训模型掩盖 policy、provider、market 或 data source 变化。

## 6.7 Drift Response

检测到 drift 后可以：

- 增加 monitoring；
- 降低 traffic；
- 增加 human review；
- 切换 approved baseline；
- pause model release；
- require new evaluation；
- create RiskEvent / Finding；
- re-approve Market / Policy；
- rollback。

不能在没有分析的情况下自动重训并直接上线。

## 6.8 Model Incident

```text
ModelIncident
├── id
├── model_version_ref
├── source_signal
├── incident_type: HARMFUL_OUTPUT / FALSE_ALLOW / FALSE_DENY / LEAKAGE / BIAS / DRIFT / OUTAGE / OVERRIDE_ABUSE / ACTION_MISMATCH
├── affected_scope
├── affected_decisions[]
├── severity
├── containment
├── notification_decision
├── linked_risk_event_ref?
├── linked_finding_ref?
├── root_cause
├── remediation_refs[]
├── status: OPEN / CONTAINED / INVESTIGATING / REMEDIATING / RESOLVED / CLOSED / REOPENED
└── audit_ref
```

## 6.9 Model Rollback

Rollback 必须：

- 停止或减少新 model traffic；
- 切换到 approved baseline / manual review；
- 保留已产生的 ModelOutput / DecisionTrace；
- 评估已执行的 Domain commands；
- 检查 customer / Enterprise / regulator notification；
- 更新 Risk / Compliance / Board evidence；
- 不删除历史 model version 或 training data lineage。

---

# 7. Model Output / Domain / Human Oversight

## 7.1 Output Roles

模型输出只能扮演：

```text
SIGNAL
RANKING_INPUT
FORECAST
REVIEW_PRIORITY
RECOMMENDATION
DRAFT
```

进入 M2 / M3 use case 时，必须明确 human review、hard guardrail 和 Domain command path。

## 7.2 High-risk Actions

以下 action 默认不允许 autonomous model mutation：

- KYC / AML / Sanctions final decision；
- Safety emergency / block / incident closure；
- Payment authorization / refund / payout；
- Ledger posting / correction；
- account closure / permanent restriction；
- precise location / D4 / D5 access；
- Contract acceptance / termination；
- Tax filing / legal attestation；
- Market go-live / retirement；
- employee / Agent earnings adjustment。

模型可以提供 signal、priority、draft 或 proposed command，但必须经 approved control / human / Domain authority。

## 7.3 Human Oversight Modes

| 模式 | 要求 |
|---|---|
| `NONE` | 仅 M0 / 非决定性内容，不能影响受保护权益 |
| `ON_THE_LOOP` | 系统自动运行，human 监控 metrics / alerts，可暂停 |
| `IN_THE_LOOP` | 每个 high-impact decision 需 human review 后才执行 |
| `HUMAN_ONLY` | AI 只能提供资料，最终判断必须由 authorized human / Domain |

## 7.4 Human Review Quality

Human review 必须避免：

- rubber stamp；
- automation bias；
- reviewer conflict；
- insufficient training；
- excessive workload；
- inconsistent rubric；
- hidden model output anchoring；
- unauthorized data access。

## 7.5 Automation Bias Controls

可采用：

- blind review / reason-first review；
- display uncertainty；
- require independent evidence；
- random quality sampling；
- second reviewer for P0 / P1；
- reviewer override audit；
- disagreement analysis；
- no auto-fill final decision；
- escalation on repeated override pattern。

## 7.6 Model-to-Command Boundary

标准流程：

```text
ModelOutput
→ PolicyEvaluationContext
→ PolicyDecision / GuardrailEvaluation
→ Human review, if required
→ CommandProposal
→ Domain authorization / revalidation
→ Domain command
→ Domain state / event / audit
```

---

# 8. Generative AI / Prompt / Retrieval Governance

## 8.1 Allowed GenAI Uses

P0 可考虑：

- Support draft；
- internal summary；
- policy / runbook search；
- audit evidence indexing；
- translation draft；
- non-binding explanation draft；
- simulation / test case suggestion；
- operator next-step suggestion。

## 8.2 Restricted GenAI Uses

必须 human / Domain controlled：

- KYC / Sanctions explanation；
- Safety response draft；
- Payment / Payout support action；
- Contract / tax / legal advice；
- customer-facing rejection reason；
- financial report narrative；
- model risk / incident conclusion；
- sensitive export / audit response。

## 8.3 Prompt Injection Defense

RAG / agent system 必须区分：

- system instruction；
- policy / control；
- trusted reference；
- user content；
- provider output；
- tool result；
- untrusted retrieved text。

Retrieved document、User text 或 Provider output 不能改变 system policy、permissions、tool allowlist 或 Domain authority。

## 8.4 Citation / Grounding

生成式输出用于事实性说明时必须：

- 引用 source ref；
- 标记 unknown / uncertainty；
- 区分 source fact 与 generated summary；
- 对关键 Finance、Legal、KYC、Safety、Privacy 结论要求 human verification；
- 无 source 时拒答、转人工或标记 draft。

## 8.5 Tool Use Boundary

LLM / AI tool call 必须：

- allowlisted；
- schema validated；
- principal context；
- scope；
- purpose；
- rate limit；
- idempotency；
- confirmation / approval；
- audit；
- no arbitrary SQL / shell / Provider mutation。

## 8.6 Generated Content Status

所有生成内容必须标记：

```text
DRAFT
AI_ASSISTED
HUMAN_REVIEWED
APPROVED
PUBLISHED
RETRACTED
```

`AI_ASSISTED` 不等于 approved、verified 或 legal advice。

---

# 9. Vendor / Third-party Model Governance

## 9.1 VendorModelProfile

```text
VendorModelProfile
├── id
├── vendor_ref
├── model_name / version
├── hosted_region
├── data_processing_terms
├── retention / training_use
├── subprocessor_refs[]
├── security_assurance_refs[]
├── privacy_review_ref
├── model_risk_review_ref
├── SLA / quota / pricing
├── failure / outage behavior
├── exit / portability plan
├── approved_use_cases[]
├── prohibited_use_cases[]
├── owner_ref
└── status: ASSESSING / APPROVED / ACTIVE / DEGRADED / SUSPENDED / RETIRED
```

## 9.2 Vendor Due Diligence

至少检查：

- data residency；
- input / output retention；
- vendor training reuse；
- deletion / correction；
- security / secret handling；
- prompt / retrieval isolation；
- model / API versioning；
- audit / incident notice；
- bias / performance evidence；
- service availability；
- rate / cost；
- exit / fallback；
- contract / DPA。

## 9.3 Vendor Output Boundary

Provider 或 Vendor `approved`、`safe`、`fraud`、`verified`、`complete` 输出必须经过：

- correlation to request / user / market；
- signature / authenticity；
- schema normalization；
- expiry；
- local policy；
- human / Domain review；
- audit。

Vendor output 不能直接成为 Proxy canonical fact。

## 9.4 Vendor Change

Vendor model、region、terms、retention、subprocessor、weights、API schema 或 training use 改变时触发 Chapter 38 ChangeImpactAssessment、Chapter 34 ComplianceReview 和 Chapter 37 Model / Risk review。

## 9.5 Vendor Exit

退出前必须：

- stop new traffic；
- classify in-flight calls；
- preserve required outputs / trace；
- route to approved fallback / manual review；
- revoke credentials；
- delete / export according to legal / contract；
- update policy / model binding；
- reconcile cost / billing；
- communicate impacted users / Enterprise；
- close VendorModelProfile。

---

# 10. Privacy / Security / Retention / Rights

## 10.1 Training Data Rights

用户或 Enterprise 的 consent withdrawal、deletion、correction、do-not-profile、residency restriction 或 LegalHold 必须评估：

- raw dataset；
- snapshots；
- labels；
- feature store；
- model training artifact；
- embeddings / retrieval index；
- evaluation set；
- inference log；
- output cache；
- vendor copy；
- reports / evidence。

## 10.2 Model Memorization

如果数据主体删除后模型可能记忆并输出其数据，必须有：

- risk assessment；
- output filter；
- unlearning / retraining plan；
- vendor process；
- safe limitation；
- escalation。

不能声称“从原始表删除”就等于所有模型已不再包含相关信息。

## 10.3 Inference Data

线上 inference 的输入、输出、trace、prompt、retrieval、review 和 command proposal 按 purpose、classification、retention 和 access policy 处理。

## 10.4 Security Controls

模型系统必须有：

- artifact access control；
- signed deployment；
- secret isolation；
- tenant isolation；
- prompt / retrieval filtering；
- output validation；
- rate limit；
- abuse detection；
- audit；
- rollback；
- incident response。

## 10.5 Restricted Model Data

默认禁止把以下内容输入未批准模型 / Vendor：

- Government ID / raw KYC；
- bank / payout credential；
- session token / API secret；
- precise location history；
- private chat；
- unredacted incident investigation；
- other Enterprise confidential data；
- legal privileged material；
- hidden risk rules。

## 10.6 Retention

Model / AI data retention 结合：

- Chapter 24 D0–D5；
- Chapter 34 Evidence / LegalHold；
- Chapter 37 Audit / Board；
- Chapter 38 change lineage；
- Contract / DPA；
- Provider / Vendor terms；
- incident / dispute。

---

# 11. Model Monitoring / Incident / Rollback

## 11.1 ModelMonitoringProfile

```text
ModelMonitoringProfile
├── id
├── model_version_ref
├── metrics[]
├── segment_metrics[]
├── drift_monitors[]
├── latency / availability
├── fallback_rate
├── override_rate
├── appeal_rate
├── harm / error signals
├── alert thresholds
├── escalation_refs[]
├── owner_ref
├── cadence
└── status: DRAFT / ACTIVE / PAUSED / RETIRED
```

## 11.2 Monitoring Windows

上线后至少设置：

- canary window；
- initial observation window；
- steady-state monitoring；
- post-change comparison；
- delayed-label review；
- high-severity incident watch。

## 11.3 Alert Actions

Alert 可以触发：

- increase sampling；
- human review；
- reduce traffic；
- switch baseline；
- pause model；
- block CommandProposal；
- create ModelIncident / RiskEvent / Finding；
- re-evaluate Market / Policy；
- rollback release。

Alert 不能直接逆转已完成的 Order、Payment、Payout、Ledger、KYC 或 Safety state。

## 11.4 Model Incident Response

```text
DETECT
→ TRIAGE
→ CONTAIN
→ PRESERVE TRACE / DATA
→ ASSESS IMPACTED DECISIONS
→ NOTIFY / ESCALATE
→ MITIGATE / ROLLBACK
→ REVIEW DOMAIN SIDE EFFECTS
→ REMEDIATE
→ RETEST
→ CLOSE / REOPEN
```

## 11.5 Impacted Decision Review

模型 incident 影响历史 decision 时，必须分类：

- no Domain command executed；
- reversible proposal only；
- Domain command executed but no material effect；
- financial / privacy / safety impact；
- customer / Enterprise impact；
- regulatory / reporting impact。

需要 correction、refund、Safety review、privacy notice、financial restatement 或 contract communication 时，走所属 Domain / Governance 流程。

## 11.6 Rollback / Baseline

Rollback target 必须是：

- approved baseline model；
- approved rule policy；
- manual review；
- safe deny / pending path；
- provider fallback。

不能回滚到未测试、已撤回、过期或不再合法的模型 / policy。

## 11.7 Post-incident Review

必须更新：

- FailureModeRecord；
- ModelRiskAssessment；
- Bias / Drift assessment；
- DataQualityProfile；
- Policy / Guardrail；
- training / evaluation；
- monitoring；
- Human oversight；
- Vendor profile；
- Board / Compliance evidence。

---

# 12. Governance / Access / Accountability

## 12.1 Roles

| 角色 | 可做 | 不可做 |
|---|---|---|
| DataOwner | 决定 source、quality、purpose、access | 单独批准 model use / high-risk decision |
| DataSteward | lineage、quality、classification、retention | 改写 Domain facts |
| FeatureOwner | feature definition、freshness、point-in-time | 直接决定用户 eligibility |
| ModelOwner | model build、evaluation、monitoring、rollback | 代替 Domain owner 做交易 mutation |
| DomainOwner | 定义业务 use、guardrail、command boundary | 省略 model risk / privacy review |
| ModelRiskReviewer | assessment、bias、drift、limitations | 独立部署或修改 model artifact |
| PrivacyReviewer | purpose、D0–D5、consent、residency | 扩大 model permission |
| SecurityReviewer | artifact、access、vendor、prompt、incident | 修改 KYC / Ledger / Safety state |
| HumanReviewer | 在 scope 内 review / appeal / proposed action | 绕过 hard guardrail或无限期 override |
| AI / VendorOwner | vendor diligence、contract、quota、exit | 将 vendor output 当 canonical fact |
| Auditor | 独立查验、重测、报告 | 运行被审计模型或独立关闭 finding |
| Board / Committee | appetite、risk acceptance、资源、pause、oversight | 直接执行 model / Domain command |

## 12.2 SoD Rules

默认禁止同一人独立完成：

- Dataset creator + sole approval；
- Model trainer + sole validation；
- ModelOwner + sole ModelRiskReviewer；
- VendorOwner + sole privacy / security approver；
- Model deployer + sole rollback approver；
- HumanReviewer + sole appeal reviewer；
- Model incident responder + sole closure verifier；
- FeatureOwner + sole fairness approver。

## 12.3 High-risk Access

以下操作需要 step-up、purpose、scope、SoD 和 Audit：

- 下载 training dataset / model artifact；
- 修改 label / feature / threshold；
- 部署 M2 / M3 model；
- 查看 sensitive model trace；
- 导出 prompt / retrieval / customer data；
- 批量 human override；
- 改变 vendor data use；
- 执行 model rollback；
- 修改 model monitoring thresholds；
- 关闭 ModelIncident；
- 重新训练并替换 production model。

## 12.4 AccountabilityAssignment

每个 ModelRegistryEntry、DataAsset、FeatureDefinition、ModelIncident、ModelRiskAssessment 和 ModelRelease 都必须有：

- accountable owner；
- responsible operator；
- reviewer；
- informed stakeholders；
- authority scope；
- review cadence；
- expiry / retirement owner。

## 12.5 Board / Compliance Reporting

高影响模型的 Board / Compliance pack 至少包含：

- inventory；
- use tier；
- active scope；
- performance / fairness / drift；
- override / appeal；
- model incidents；
- vendor / concentration；
- privacy / security findings；
- open remediation；
- limitations；
- decision required。

---

# 13. API / Command / Event Contract

## 13.1 P0 Commands

| Command | Owner | 结果 |
|---|---|---|
| `RegisterDataAsset` | DataOwner | 建立数据资产与分类 |
| `ApproveDataUse` | Privacy / Legal / DataOwner | 批准训练 / 推理 / 评估用途 |
| `CreateDataset` | DataSteward | 创建 dataset lineage / snapshot |
| `FreezeDatasetSnapshot` | DataSteward | 冻结训练 / 测试输入 |
| `DefineFeature` | FeatureOwner | 创建 feature / freshness / use boundary |
| `RegisterModel` | ModelOwner | 建立 model inventory |
| `CreateTrainingRun` | ModelOwner | 记录训练过程与输入 |
| `EvaluateModel` | ModelRiskReviewer | 记录性能、偏差、鲁棒性与限制 |
| `ApproveModelRisk` | Risk / Compliance | 批准 intended use 与 oversight |
| `ReleaseModel` | Engineering / ModelOwner | 受控部署模型版本 |
| `CreateModelMonitoring` | ModelOwner | 激活 drift / performance / harm monitor |
| `RecordModelIncident` | Incident / ModelRisk | 创建并升级模型事件 |
| `RollbackModelRelease` | Authorized owner | 切换 baseline / manual / safe path |
| `RequestHumanReview` | Runtime / Support | 创建人工复核 |
| `RecordModelAppeal` | HumanReviewer | 记录申诉复核结果 |
| `ApproveGenAIUse` | AI / Privacy / Security | 批准 prompt / retrieval / vendor use |
| `ApproveVendorModel` | Vendor / Risk / Privacy | 批准第三方模型范围 |
| `RetireModel` | ModelOwner / Governance | 停止新使用并保留 lineage |

## 13.2 P0 Events

```text
DataAssetRegistered
DataUseApproved
DatasetCreated
DatasetSnapshotFrozen
DatasetRestrictionApplied
FeatureDefinitionApproved
ModelRegistered
TrainingRunCompleted
ModelEvaluationCompleted
ModelRiskApproved
BiasAssessmentCompleted
DriftMonitorBreached
ModelReleased
ModelReleasePaused
ModelRollbackStarted
ModelIncidentOpened
ModelIncidentContained
ModelIncidentResolved
HumanReviewRequested
HumanReviewCompleted
ModelAppealRecorded
VendorModelApproved
VendorModelSuspended
PromptTemplateApproved
RetrievalProfileApproved
GenAIUsePaused
ModelRetired
```

事件只包含 model / dataset / feature / scope / status / severity / reference / metrics summary，不包含 raw training data、secret、完整 prompt、个人原文或敏感模型 artifact。

## 13.3 Downstream Boundary

本章 events 可以通知：

- Chapter 23 Policy runtime；
- Chapter 24 Consent / Privacy / KYC / Safety；
- Chapter 34 Evidence / Compliance / Trust；
- Chapter 37 Risk / Audit / Board；
- Chapter 38 Change / Re-approval；
- Chapter 39 Decision / Guardrail / Explainability；
- Support / Enterprise / Provider operations；
- Chapter 35 / 36 Finance / Treasury / Revenue。

本章 events 不能未经 Domain command 直接：

- 写 Ledger；
- 改 Payment / Payout / Invoice / Tax；
- 标记 KYC verified；
- 关闭 Safety Incident；
- 关闭 UserAccount；
- 改 Contract / Market / LegalEntity；
- 删除 Audit / LegalHold / Consent evidence。

---

# 14. Acceptance Criteria

## AC-40-01 — Model Inventory

所有 production 或影响产品决策的模型、第三方模型、Prompt chain、RAG、embedding、临时脚本和 Operator AI tool 都必须有 ModelRegistryEntry 或明确标记为 prohibited / non-production。

## AC-40-02 — Intended Use

每个 ModelVersion 必须有 use case、risk tier、allowed decision role、prohibited roles、scope、human oversight、hard guardrails、expiry 和 approval。

## AC-40-03 — Data Asset Classification

DataAsset 必须记录 source、owner、domain、classification、D0–D5、purpose、lawful basis、residency、retention、quality、access 和 lineage。

## AC-40-04 — Data Use Approval

训练、推理、评估、监控、debug 或 export 前必须有 DataUseApproval，明确 fields、scope、purpose、consent / legal basis、prohibited uses、residency 和 expiry。

## AC-40-05 — Dataset Lineage

Dataset 必须记录 source assets、snapshot、population、inclusion / exclusion、time window、market / entity、label、features、DQ、split、leakage、checksum 和 retention。

## AC-40-06 — Dataset Snapshot Integrity

DatasetSnapshot 必须保存 source watermark、record count、label / segment distribution、missingness、duplicate / outlier profile、hash 和 generated time。

## AC-40-07 — Label Definition

LabelDefinition 必须定义 source、observation window、positive / negative / unknown、censoring、leakage risk、human review 和版本；label 不得被当成无条件事实。

## AC-40-08 — Data Quality Gate

DataQualityProfile 必须评估 completeness、validity、accuracy evidence、consistency、timeliness、uniqueness、representativeness 和 freshness；FAIL / UNKNOWN 时不得静默训练或上线。

## AC-40-09 — Data Subject Restriction

Consent withdrawal、delete、correct、do-not-profile、residency restriction 或 LegalHold 必须能传播到 dataset、feature、model、embedding、inference log、cache、report 和 vendor copy。

## AC-40-10 — Feature Governance

FeatureDefinition 必须有 source、transformation、unit、freshness、point-in-time、allowed / prohibited use、sensitive / proxy flag、missing behavior、owner 和版本。

## AC-40-11 — Point-in-time Correctness

训练、评估、回放和线上推理不得使用当时不可获得的未来事件、后置 outcome、未来 Payment / Payout / Incident、修正后的历史结果或人工后见之明。

## AC-40-12 — Sensitive Feature Review

raw KYC、Government ID、精确 location、private chat、bank credential、protected attribute 或明显 proxy 不得用于未批准的 Ranking、Pricing、Eligibility、Fraud 或 Support priority。

## AC-40-13 — Model Version Integrity

ModelVersion 必须绑定 artifact hash、code / dependency、feature set、dataset / training、evaluation、calibration、threshold、explainability、limitations 和 effective period。

## AC-40-14 — Training Run Traceability

TrainingRun 必须记录数据、feature、label、code、hyperparameter summary、seed、environment、data-use approval、privacy / leakage / fairness checks 和 output model。

## AC-40-15 — Evaluation Completeness

ModelEvaluation 必须按 intended use 记录总体、分 segment、calibration、error、baseline、limitations、evaluator、time 和 PASS / LIMITATION / FAIL / INCOMPLETE。

## AC-40-16 — Baseline Comparison

新模型必须与 production、rule / heuristic 和 human baseline（适用时）比较，不能只用单一准确率或 AUC 证明上线安全。

## AC-40-17 — Robustness

模型验证必须覆盖 missing / malformed、OOD、adversarial / prompt injection、duplicate / replay、provider timeout、stale feature、locale / market shift、policy mismatch 和 concurrent state change。

## AC-40-18 — Privacy / Security Validation

模型发布前必须评估 training leakage、memorization、membership inference、prompt / retrieval leakage、tenant isolation、D4 / D5 exposure、deletion propagation、artifact access 和 vendor retention。

## AC-40-19 — Model Risk Assessment

ModelRiskAssessment 必须绑定 intended use、scope、inherent / residual risk、failure modes、controls、evidence、human oversight、uncertainty、risk acceptance 和 next review。

## AC-40-20 — Bias Assessment

BiasAssessment 必须覆盖敏感 / proxy segments、数据质量、segment metrics、disparity、causal limitations、mitigation 和 decision impact；不能只看 aggregate metric。

## AC-40-21 — Fairness Does Not Override Safety

公平性 mitigation 不能取消真实 capability、Safety、KYC、Consent、Legal、Payment 或 Money hard gate，但必须识别错误使用敏感属性和错误代理变量。

## AC-40-22 — Drift Monitoring

生产模型必须监控 data、concept、label、performance、segment、policy、provider 和 environment drift，并定义阈值、owner、alert、fallback 和 escalation。

## AC-40-23 — Model Incident

Harmful output、false allow / deny、leakage、bias、drift、outage、override abuse 或 action mismatch 必须能创建 ModelIncident、RiskEvent / Finding、containment、notification、remediation 和 closure。

## AC-40-24 — Model Rollback

Rollback 必须切换到 approved baseline、approved rule、manual review、safe deny / pending 或 provider fallback，并保留历史 ModelOutput、DecisionTrace、Domain impact 和 audit。

## AC-40-25 — Output Role Boundary

Model output 只能作为 signal、ranking input、forecast、review priority、recommendation 或 draft；不能直接成为 KYC、Safety、Payment、Payout、Ledger、Tax、Invoice、Contract 或 Account state。

## AC-40-26 — High-risk Human Oversight

KYC / AML / Sanctions final decision、Safety action、Payment / Payout、Ledger、Account closure、D4 / D5 access、Contract acceptance、Tax filing 和 Market activation 不得 autonomous model mutation。

## AC-40-27 — Human Review Quality

高影响人工 review 必须有 reviewer training、rubric、evidence、SLA、conflict check、automation-bias control、appeal / escalation 和独立质量抽样。

## AC-40-28 — GenAI Grounding

生成式 AI 的事实性输出必须区分 source fact 与 generated summary，提供 citation / uncertainty；无 source 时必须 draft、拒答或转人工。

## AC-40-29 — Prompt Injection Boundary

RAG / Agent 必须隔离 system instruction、policy、trusted source、user content、Provider output 和 tool result；retrieved text 不能改变 permission、tool allowlist 或 Domain authority。

## AC-40-30 — AI Tool Use

AI tool call 必须 allowlist、schema validate、principal / scope / purpose、rate limit、idempotency、approval / confirmation、audit，不能执行 arbitrary SQL、shell 或 Provider mutation。

## AC-40-31 — Vendor Model Due Diligence

VendorModelProfile 必须检查 region、retention、training reuse、subprocessor、security、privacy、bias / performance、availability、quota、cost、exit、DPA 和 approved / prohibited use。

## AC-40-32 — Vendor Change

Vendor model、region、terms、retention、subprocessor、weights、API 或 training use 变化必须触发 Chapter 38 ChangeImpact、Chapter 34 ComplianceReview 和 Chapter 37 Model / Risk review。

## AC-40-33 — Model Release Gate

ModelRelease 进入 ACTIVE 前必须有 approved ModelRisk、evaluation、monitoring、guardrails、rollout、rollback、support、training、privacy / security approval 和 SoD。

## AC-40-34 — Trace / Data Boundary

Model trace、explanation、fixture、prompt、retrieval、output、export 和 vendor package 必须遵守 D4 / D5、secret、bank、purpose、TTL、redaction、retention 和 audit boundary。

## AC-40-35 — Model Incident Impact Review

模型事件必须分类受影响的 proposal、Domain command、金融、隐私、安全、客户、Enterprise、监管和报告影响，并由所属 Domain / Governance 流程处理 correction、notice、restatement 或 appeal。

## AC-40-36 — No Fabricated AI Fact

系统不得因为模型 score、prediction、label、evaluation PASS、vendor output、AI explanation、human suggestion 或 rollback success 自动生成 KYC VERIFIED、Safety resolved、Payment success、Payout paid、Ledger balance、Tax filed、Contract accepted 或 Market ACTIVE 事实。

---

# 15. P0 / P1 Boundary

## 15.1 P0

- DataAsset、DataUseApproval、Dataset、DatasetSnapshot、DatasetSplit、LabelDefinition、DataQualityProfile、DataLineage、DataSubjectRestriction；
- FeatureDefinition、FeatureSnapshot、point-in-time、sensitive / proxy feature、feature store boundary；
- ModelRegistryEntry、ModelVersion、ModelIntendedUse、ModelDependency、ModelRelease、PromptTemplate、RetrievalProfile；
- TrainingRun、ModelEvaluation、ModelRiskAssessment、FailureModeRecord、BiasAssessment、DriftMonitor、ModelIncident；
- Model output、human oversight、high-risk action、Domain command boundary；
- GenAI grounding、prompt injection、tool allowlist、vendor due diligence；
- Privacy、Security、Retention、Delete / Opt-out propagation；
- monitoring、rollback、incident、appeal、SoD、audit；
- 36 项 AC-40 验收标准。

## 15.2 P1

- automated dataset representativeness diagnosis；
- causal fairness analysis assistant；
- privacy-preserving synthetic data generation；
- federated / confidential model training；
- automated unlearning orchestration；
- model card generation；
- drift root-cause recommendation；
- multi-model ensemble optimizer；
- human review workload optimizer；
- AI-assisted audit evidence mapping；
- benchmark and red-team corpus management。

P1 自动化不能改变 P0 的 data purpose、model inventory、human oversight、high-risk action、privacy、safety、money、KYC、Ledger、audit、rollback 或 Domain truth boundary。

---

# 16. Locked Conclusions / Next Work

本章锁定：

```text
数据可用性不等于数据许可
Feature、Label、Model output 不等于 Domain fact
模型必须有 intended use、risk tier、scope、owner、version 和 human oversight
训练、评估、推理、Prompt、RAG 和 Vendor 都必须有 lineage、privacy、security 和 retention
Bias、Drift、OOD、Leakage、False allow / deny 和 Override abuse 必须可监控、可升级、可回滚
AI 不能自主执行 KYC、Safety、Payment、Payout、Ledger、Tax、Contract 或 Account mutation
生成式 AI 必须 grounding、citation、uncertainty、tool allowlist 和 prompt injection defense
模型回滚停止未来使用，但不删除历史 output、trace、Domain facts 或 audit
```

下一步进入：

```text
Chapter 41 — AI-assisted Operations / Agentic Workflow / Delegated Action Governance
```

Chapter 41 将在本章 Model / AI Governance 基础上，继续定义 AI-assisted Operator、Agentic Workflow、Delegated Action、Tool Permission、Approval Chain、Action Sandbox、Human Handoff 和不可逆操作防护。
