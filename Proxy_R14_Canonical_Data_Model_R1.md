# Proxy R14 — Canonical Data Model R1

**用途**：R14 Real Network Vertical Slice 的服务端对象边界。  
**注意**：这是领域契约，不要求按对象一比一建表，但任何物理模型都必须保留这些语义边界。

---

# 1. Identity

```text
UserAccount
Principal
AgentProfile
```

一个账号可以拥有多个业务 Principal；Agent 是 Principal 的能力与经营身份，不等于登录账号。

# 2. Location

```text
Market
Area
LocalContext (session / user preference)
TaskLocation
MeetingPoint
ExactLocationGrant
```

不得合并。

# 3. Social

```text
Post
MediaAsset
PostContextRef
Follow
Reaction
Reply
Repost
Bookmark
```

Post durable；实时商业事实读取时 Hydration。

# 4. Communication

```text
Conversation
ConversationParticipant
Message
ReadCursor
ConversationOrigin
```

Conversation 必须保存来源。

# 5. Demand

```text
Need
NeedVersion
TaskNeedProfile
Requirement
Task
TaskSlot
```

Need 是用户意图真相，Task 是可执行工作。

# 6. Supply

```text
AgentService
Capability
CapabilityVerification
AvailabilityWindow
ServiceArea
```

Capability / Verification / Availability 必须可独立变化。

# 7. Matching

```text
MatchAttempt
EligibilitySnapshot
AvailabilitySnapshot
CandidateBatch
Candidate
Offer
```

CandidateBatch 是一次有限候选集的快照。

# 8. Transaction

```text
Order
OrderVersion / Amendment
CompensationTerms
SettlementRecord
```

`DIRECT_SETTLEMENT` 与 `PLATFORM_PAY` 语义隔离。

# 9. Execution

```text
ExecutionSession
CheckIn
ExecutionEvent
IssueCase
```

# 10. Outcome

```text
Outcome
OutcomeObservation
Satisfaction
RepeatRelationship
```

客观事实与主观满意分离。

# 11. Network Intelligence

```text
InteractionEvent
DemandAttributionLineage
RelationshipSignal
```

Event Append-Only；Lineage 保留原始来源。

# 12. Minimum Relationship Map

```text
Principal 1—N Post
Principal N—N Conversation
Post 0—N Conversation
Conversation 0—N Need
Need 1—N NeedVersion
Need 1—1 Task
Task 1—N TaskSlot
Task 1—N CandidateBatch
CandidateBatch 1—N Candidate
Candidate N—0..1 Offer
TaskSlot 0..1—1 Order
Order 1—0..1 Outcome
Outcome 0..1—1 RepeatRelationship

Post / Conversation / Need / Order
         ↘
     InteractionEvent

Need / Order
         ↘
DemandAttributionLineage
```

# 13. Source-of-Truth Matrix

| Fact | Source of Truth |
|---|---|
| Post body | Post |
| Current Agent availability | AvailabilityWindow |
| Capability passed | CapabilityVerification |
| Current service status | AgentService |
| Need requirements | NeedVersion / TaskNeedProfile |
| Candidate eligibility | EligibilitySnapshot + referenced truths |
| Agreed price | Order Compensation Snapshot |
| Platform money | Platform Ledger only |
| Direct cash paid | Counterparty declarations / SettlementRecord |
| Actual execution state | Order / ExecutionSession |
| Outcome objective facts | OutcomeObservation |
| Satisfaction | Satisfaction |
| Original acquisition | DemandAttributionLineage |
