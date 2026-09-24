# Proxy PRD v1.4 — Human × Scene × Time × Space Infrastructure Freeze

## AI Command Surface / Unified Server Truth / Scene SaaS / Creator Commercial Infrastructure

**Date:** 2026-08-20  
**Status:** INFRASTRUCTURE ARCHITECTURE FREEZE / SERVER TRUTH FREEZE / COMMAND SURFACE FREEZE / SCENE SAAS DECOMPOSITION FREEZE  
**UI Baseline:** `Proxy_P0_Prototype_R15_12_10_Creator_Availability_Market.html`  
**Prototype decision:** **No UI rewrite in this version.** R15.12.10 remains the current consumer-facing prototype baseline.  
**Priority:** If historical PRD sections conflict with this document on server architecture, scene integration, creator channel requirements, command execution, canonical truth, availability locking, offer competition, or cross-client state ownership, **this document wins**.

---

# 0. Executive Freeze

Proxy is no longer defined only as a consumer marketplace or Creator app.

The platform north star is:

> **Proxy is a real-world Human & Scene Orchestration Infrastructure.**

Its core job is to coordinate:

```text
Human
×
Scene
×
Time
×
Space
×
Demand
×
Commercial Terms
```

and convert them into:

```text
Eligible Offer
→ Assignment / Reservation
→ Real-world Execution
→ Outcome
→ Attribution
→ Settlement
```

The consumer app is only one client.

The system must support independent clients such as:

```text
Consumer Proxy App
Creator Web / Zalo / lightweight console
KTV Android SaaS
Venue Web SaaS
Merchant Console
Operations Console
Partner API
Future Apps
```

All clients consume the **same canonical server truth**.

The hard architecture rule is:

> **App owns UX. Platform owns truth.**

No client may own a private duplicate of Human, Venue, Space, Availability, Demand, Assignment, Outcome, or Economic truth.

---

# 1. Why this revision exists

R15.12.10 clarified the consumer Market UX:

- TikTok / Instagram can remain the primary Creator content surface;
- Proxy Feed is not duplicated inside Market;
- Proxy Market organizes actionable Creator availability and transaction objects;
- Experience / Opportunity / Activity remain the frozen first-level Market objects;
- LIST / MAP remains frozen;
- Creator is not a priced shelf object.

This revision adds the missing infrastructure layer.

The previous architecture was strong on the **Human side**:

```text
Identity
Capability
Willingness
Availability
Behavior
Matching
Outcome
Settlement
```

but it did not yet make the **Scene side** equally first-class.

The new infrastructure must understand both:

```text
Who is available?
```

and:

```text
Which real-world scene / room / table / venue / activity area is available?
```

Therefore the closed loop becomes:

```text
Human Supply
        │
        ▼
Availability
        │
        ├──────────────┐
        │              │
        ▼              ▼
Demand             Scene Supply
                       │
                 Venue / Space
                 Capacity / Time
                 Commercial Offer
        │              │
        └──────┬───────┘
               ▼
         Orchestration
               ▼
        Composite Offer
               ▼
 Assignment / Reservation
               ▼
          Check-in
               ▼
          Execution
               ▼
           Outcome
               ▼
 Attribution / Settlement
```

---

# 2. Product North Star

## 2.1 Consumer value

The user should be able to express intent naturally:

```text
今晚 8 点，6 个人，D1 附近找一个环境好一点的 KTV，
预算 5M，希望有 2 个会中文的 Creator 一起参加。
```

Proxy should return executable real-world options backed by live truth:

```text
Venue availability
Space availability
Price
Discount
Creator availability
Creator eligibility
Travel feasibility
Scene benefits
Commercial terms
Estimated total
```

The user must not manually query multiple venues, multiple Creators, multiple chats, and multiple price lists.

---

## 2.2 Creator value

Proxy exists to improve the economic value of a Creator's limited time.

The system should help answer:

```text
我今晚有 4 小时空，做什么最值得？
```

Possible server-backed output:

```text
Brand Activity
预计收入 1.1M
3.2km
商家权益 200k equivalent

Scene Collaboration
预计收入 850k
场地权益 300k
高复购可能

Cafe Campaign
650k
低通勤
长期品牌合作概率较高
```

Proxy is not required to own Creator attention.

Creators may continue operating:

```text
TikTok
Instagram
Facebook
Zalo
```

Proxy should own the **commercial state**, not necessarily the daily content habit.

---

## 2.3 Scene value

A venue should be able to convert idle physical capacity into demand.

Example KTV command:

```text
今晚 22 点以后还有 5 个空包，
帮我拉客，最多让 15%，Creator 到店酒水免费。
```

The platform converts this into structured supply:

```text
SceneSupply
Venue = KTV_A
TimeWindow = 22:00–02:00
AvailableSpaces = 5
MaxDiscount = 15%
CreatorBenefit = FREE_DRINKS
CustomerAcquisition = ON
```

The scene can then compete for qualified customer demand.

---

## 2.4 Platform value

Proxy becomes valuable when other software and businesses depend on its orchestration layer.

The infrastructure becomes defensible when:

```text
Creator does not need Proxy consumer app
Venue does not need Proxy consumer UI
Merchant does not need Creator UI
Partner does not need Proxy branding
```

but all of them still rely on:

```text
Identity
Availability
Scene truth
Matching
Offer
Assignment
Attribution
Settlement
```

---

# 3. Product decomposition

## 3.1 Platform architecture

```text
                   External World
        TikTok / Zalo / Web / Merchants
       Agencies / Venues / Partner Systems
                         │
                         ▼
                  Access Layer
          Link / QR / API / Bot / App
                         │
                         ▼
              AI Command Surface
                         │
                         ▼
         Unified Orchestration Platform
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
   Human Core         Scene Core       Commerce Core
       │                 │                 │
 Identity           Venue             Demand
 Capability         Space             Offer
 Availability       Schedule          Order
 Preference         Capacity          Attribution
 Trust              Requirement       Settlement
 Reputation         Scene Policy      Outcome
       │                 │                 │
       └──────────── Orchestration ────────┘
                         │
                         ▼
                   Client Surfaces
```

---

## 3.2 Client surfaces

### A. Consumer Proxy App

Responsibilities:

```text
Intent capture
Market discovery
Map / list
Experience
Opportunity
Activity
Booking / reservation
Relationship
Payment presentation
Outcome / review
```

It does **not** own canonical inventory truth.

---

### B. Creator access

Creator access may be implemented as:

```text
Web
PWA
Zalo link / bot
SMS deep link
Creator console
Operations-assisted workflow
```

A native Creator app is optional.

Creator workflows:

```text
Verify identity
Declare capability
Open / close availability
Accept / decline invitation
View commercial terms
Check in
Complete work
View earnings
Manage preferences
```

---

### C. Scene SaaS

First vertical pack:

```text
KTV Scene Pack
```

Possible frontends:

```text
Android phone
Android tablet
Web SaaS
```

Scene SaaS is a **client**, not a separate truth system.

Responsibilities:

```text
Venue status
Space / room status
Schedule
Reservation
Capacity
Staff / Creator requirement
Commercial offer
Check-in
Execution state
Outcome confirmation
Settlement visibility
```

---

### D. Merchant Console

Responsibilities:

```text
Campaign
Demand
Budget
Creator requirement
Venue requirement
Attribution
Spend
Outcome
Repeat collaboration
```

---

### E. Operations Console

Responsibilities:

```text
Exception handling
Safety review
Supply health
Demand health
Scene utilization
Creator activation
Assignment recovery
Commercial disputes
Settlement review
Fraud monitoring
```

---

### F. Partner API

External systems may submit or consume:

```text
Demand
Scene capacity
Availability
Offer
Assignment state
Reservation state
Outcome
Economic events
```

Partner systems must not bypass platform Policy / Eligibility.

---

# 4. AI Command Surface

## 4.1 No new consumer UI required

The existing Home input box already acts as the command entry.

This revision does **not** add a new chat product or a new root tab.

The existing composer becomes the unified command surface.

> **The AI is the shell. The platform truth is the operating system.**

---

## 4.2 Command Surface principle

A user should not need to understand platform object taxonomy before speaking.

Bad:

```text
Select Scene Type
→ Select City
→ Select Capacity
→ Select Creator Type
→ Select Budget
→ Select Time
→ Submit
```

Preferred:

```text
Natural language command
→ Semantic interpretation
→ Bound structured intent
→ Truth query / action
→ Result
```

---

## 4.3 AI boundary

The model may:

```text
Interpret natural language
Resolve intent
Extract constraints
Ask bounded clarification
Summarize offers
Explain trade-offs
Generate presentation composition
```

The model may **not** invent:

```text
Venue availability
Room availability
Creator availability
Price
Discount
Commission
Eligibility
Safety approval
Assignment
Reservation
Settlement
Outcome
```

These must come from canonical platform truth.

---

## 4.4 Command execution pipeline

```text
Natural Language / Multimodal Input
              ↓
Semantic Intent
              ↓
Entity / Context Resolution
              ↓
Bound Command
              ↓
Policy / Permission Gate
              ↓
Truth Query
              ↓
Candidate Generation
              ↓
Eligibility
              ↓
Offer / Matching / Orchestration
              ↓
Result Composition
              ↓
User Action
              ↓
Canonical Write
```

---

## 4.5 Example — Consumer command

Input:

```text
今晚8点，6个人，D1附近KTV，预算5M，
希望环境好一点，有2个会中文的Creator参加。
```

Bound intent:

```text
Demand
city = HCMC
area = D1
start_time = 20:00
party_size = 6
scene_type = KTV
budget_max = 5_000_000

HumanRequirement
quantity = 2
language = zh
activity_scope = eligible_defined_role
```

Execution:

```text
Scene Query
→ Available Spaces
→ Venue Offers
→ Human Availability
→ Human Eligibility
→ Travel Feasibility
→ Package Assembly
→ Commercial Calculation
→ Ranked Offers
```

---

## 4.6 Example — Scene command

Input:

```text
今晚22点以后5个空包，最多让15%，
Creator到店酒水免费。
```

Writes:

```text
SceneSupply
SpaceAvailability
CommercialTerm
VenueOfferPolicy
```

No human operator should have to manually duplicate the same information into the consumer marketplace.

---

## 4.7 Example — Creator command

Input:

```text
我周五18点到23点有空，帮我看看什么最赚钱。
```

Execution:

```text
Availability update
→ Eligible Demand Query
→ Scene Query
→ Net Creator Value Calculation
→ Opportunity Ranking
```

---

## 4.8 Example — Business command

Input:

```text
周六新店开业，预算20M，
4个人负责宣发，4个人现场。
```

Execution:

```text
Campaign
→ Promotion WorkUnits ×4
→ Fulfillment WorkUnits ×4
→ Eligibility
→ Candidate Generation
→ Invite
→ Accept / Decline
→ Assignment
→ Attribution
→ Outcome
```

---

# 5. Canonical server truth

The following objects are platform-wide canonical objects.

```text
Human
Venue
Space
TimeSlot
Capability
Availability
Willingness
Demand
Requirement
Offer
CommercialTerm
WorkUnit
Assignment
Reservation
CheckIn
Interaction
Outcome
Attribution
EconomicEvent
Relationship
PolicyDecision
```

No client may create its own incompatible duplicate definition.

---

# 6. Global identity

## 6.1 Human identity

```text
GlobalPersonId
```

Example:

```text
Human H_00182
├── proxy_consumer_account
├── creator_web_account
├── future_app_account
└── partner_identity_binding
```

One human may have multiple client identities, but the platform maintains a stable canonical subject.

---

## 6.2 Venue identity

```text
GlobalVenueId
```

Example:

```text
Venue V_00581
├── KTV Android login
├── Merchant Web account
├── Consumer Market projection
└── Partner POS binding
```

---

## 6.3 Space identity

Each reservable / schedulable physical unit has:

```text
GlobalSpaceId
```

Example:

```text
Venue V_00581
├── Space SP_1001 · VIP Room 01
├── Space SP_1002 · VIP Room 02
├── Space SP_1003 · Hall
└── Space SP_1004 · Content Area
```

---

# 7. Human model

## 7.1 Human state

```text
HumanState
├── identity_state
├── qualification_state
├── capability_state
├── willingness_state
├── availability_state
├── relationship_state
├── reputation_state
├── earning_state
├── risk_state
└── lifecycle_state
```

---

## 7.2 Capability is not availability

Hard rule:

> **Capability ≠ Willingness ≠ Availability**

Example:

```text
Capability: Chinese reception = YES
Willingness: KTV scene activity = YES
Availability: Friday 18:00–23:00
```

All three must be valid before matching.

---

## 7.3 Promotion and fulfillment remain independent capabilities

```text
CreatorProfile
├── PromotionCapability
└── FulfillmentCapability
```

Creator may be:

```text
Promotion only
Fulfillment only
Hybrid
Neither
```

No third frontstage identity is required.

---

# 8. Scene model

## 8.1 Scene is a first-class supply object

A Scene is not merely a location string.

```text
Scene
├── Venue
├── Space
├── Time
├── Capacity
├── Policy
├── Availability
├── Commercial Terms
├── Requirement
└── Outcome history
```

---

## 8.2 Venue

Example fields:

```text
venue_id
tenant_id
scene_type
business_id
name
legal_entity_ref
address
geo
operating_status
operating_hours
verification_state
safety_state
commercial_state
```

---

## 8.3 Space

Example fields:

```text
space_id
venue_id
space_type
name
capacity_min
capacity_max
features
availability_policy
reservation_policy
operating_status
```

Possible types:

```text
ROOM
TABLE
BOOTH
STAGE
STUDIO
ACTIVITY_AREA
PRIVATE_AREA
OTHER
```

---

## 8.4 Scene availability

```text
SceneAvailability
space_id
start_at
end_at
state
capacity_remaining
source
version
```

Possible state:

```text
AVAILABLE
HELD
RESERVED
OCCUPIED
BLOCKED
OUT_OF_SERVICE
```

---

# 9. KTV Scene Pack

KTV is the first Scene vertical, not the platform definition.

## 9.1 KTV SaaS P0 scope

The Android / Web client should support:

```text
Venue login
Room list
Room state
Current reservation
Available room count
Customer demand
Human requirement
Creator requirement
Offer submission
Discount configuration
Creator benefit
Check-in
Completion
Basic settlement view
```

---

## 9.2 Example scene dashboard

```text
Tonight 20:00–00:00

VIP 08       RESERVED
VIP 09       AVAILABLE
VIP 10       AVAILABLE

Customer demand      3
Human gap            2
Matched              1
Pending confirmation 1

[Publish capacity]
[Request staffing]
[Submit offer]
[Confirm arrival]
```

---

## 9.3 KTV command examples

```text
今晚22点以后还有5个空包，最多打85折。
```

```text
明晚需要2个会中文的接待，19点到23点。
```

```text
VIP房今晚空3间，订单佣金可以到12%，免费升级。
```

```text
周六Creator到店酒水免费，优先给能发内容的人。
```

All commands must resolve into structured platform objects.

---

# 10. Availability engine

## 10.1 Human availability

```text
HumanAvailability
human_id
start_at
end_at
location_scope
capability_scope
scene_preference
state
source
version
```

---

## 10.2 Scene availability

```text
SpaceAvailability
space_id
start_at
end_at
capacity
state
source
version
```

---

## 10.3 Locking rule

When an Assignment is accepted:

```text
HumanAvailability → HELD / BLOCKED
```

When a Reservation is confirmed:

```text
SpaceAvailability → HELD / RESERVED
```

No second workflow may allocate the same human or same exclusive space in an overlapping time window.

---

## 10.4 Conflict prevention

The write path must enforce:

```text
Optimistic version check
Idempotency key
Time overlap check
Capacity check
Policy check
```

The UI may show stale information, but a final assignment/reservation must always revalidate against current truth.

---

# 11. Demand model

Demand is independent of the client that created it.

Possible source:

```text
Proxy Consumer
Merchant Console
KTV SaaS
Partner API
Operations
Future App
```

Canonical fields:

```text
demand_id
owner_id
owner_type
source_app
market
start_at
end_at
location_scope
budget
requirements
scene_requirements
human_requirements
status
created_at
expires_at
```

---

# 12. Requirement model

A Demand can contain multiple Requirements.

Example:

```text
Demand D_001

Requirement R1
type = SCENE
scene_type = KTV
capacity >= 6
area = HCMC_D1

Requirement R2
type = HUMAN
quantity = 2
language = zh
capability = RECEPTION
```

A Business Campaign may contain:

```text
Promotion Requirement
Fulfillment Requirement
Venue Requirement
```

---

# 13. WorkUnit model

Complex demand is decomposed into executable WorkUnits.

Example:

```text
Campaign
├── Promotion WorkUnit ×4
├── Onsite Creator WorkUnit ×3
├── Host WorkUnit ×1
└── Venue Reservation WorkUnit ×1
```

Each WorkUnit has independent:

```text
eligibility
candidate set
commercial term
assignment
outcome
settlement
```

---

# 14. Scene Supply and Venue Offer Market

## 14.1 Venue is active supply

Venues may compete for customer demand.

This is not a static directory.

A Venue may submit:

```text
Room price
Customer discount
Platform commission
Creator benefit
Upgrade
Included package
Capacity
Available time
Offer expiry
```

---

## 14.2 VenueOffer

```text
VenueOffer
offer_id
venue_id
space_id
demand_id
start_at
end_at
base_price
customer_price
discount
platform_commission
merchant_subsidy
creator_benefit
included_items
upgrade
capacity
expires_at
status
```

---

## 14.3 Competition is not highest commission wins

Ranking must not become:

```text
highest platform commission
→ highest rank
```

This creates a low-trust auction.

Candidate eligibility is resolved first.

Then ranking can consider:

```text
Customer final cost
Scene quality
Distance / travel
Availability confidence
Creator fit
Creator benefit
Venue reliability
Historical outcome
Cancellation rate
Customer preference
Current utilization
Platform economics
Exploration
```

Safety / policy is a hard gate, not a ranking bonus.

---

## 14.4 Dynamic scene competition

Example:

```text
KTV A
Occupancy 90%
Offer 3.5M

KTV B
Occupancy 40%
Offer 2.8M
Free room upgrade

KTV C
New venue
Offer 2.6M
Creator drinks free
```

The platform may recommend better commercial terms to a venue based on idle capacity, but the venue remains the commercial decision owner unless explicit auto-pricing authority has been granted.

---

# 15. Creator benefit and scene competition for Creators

Venues do not only compete for consumers.

They may also compete for valuable Creators through structured benefits.

Examples:

```text
Creator discount
Free drinks
Free meal
Free room
Priority reservation
Content-friendly area
Brand budget
Transport subsidy
Commission bonus
```

Canonical object:

```text
CreatorBenefit
```

or as a typed `CommercialTerm`.

This allows:

```text
better scene
→ better Creator participation
→ more content / demand
→ better venue utilization
```

---

# 16. CommercialTerm

Commercial terms should not be hardcoded into long-term Creator agreements.

Principle:

> **Do not freeze every temporary discount or scene deal into the master contract.  
> But every actual commercial fact must exist in the platform ledger/audit trail.**

Canonical object:

```text
CommercialTerm
term_id
issuer
beneficiary_scope
eligible_segment
benefit_type
value
currency
valid_from
valid_to
usage_limit
source_object
approval_state
policy_version
```

Examples:

```text
KTV A gives Active Creators 30% discount
Brand B pays 500k for this campaign
Venue C gives free room after 22:00
Merchant D gives 10% attributed commission
```

---

# 17. Composite Offer

The user does not necessarily buy one atomic product.

The system may assemble:

```text
Scene
+
Space
+
Human
+
Experience / Activity / Opportunity scope
+
Commercial terms
```

into a composite proposal.

Example:

```text
Option A
KTV B · VIP 6
20:00–00:00
Room = 2.3M
Free upgrade
2 eligible Creators available to invite
Estimated total = 4.6M
Distance = 1.8km
```

A composite offer is a **proposal**, not truth until each dependent component is confirmed.

---

# 18. Reservation vs Assignment

Keep physical space and human commitment distinct.

```text
Reservation = space / scene commitment
Assignment  = human / work commitment
```

They may be linked under one commercial package.

Example:

```text
Package P_001
├── Reservation RS_101
├── Assignment AS_201
├── Assignment AS_202
└── Payment Intent PI_301
```

---

# 19. Check-in and real-world execution

Infrastructure must know whether planned resources actually arrived.

Possible verification:

```text
Venue QR
Creator QR
Staff confirmation
Customer confirmation
Device check-in
Authorized geo evidence
```

No realtime Creator GPS needs to be publicly exposed.

Execution states:

```text
CONFIRMED
EN_ROUTE
ARRIVED
IN_PROGRESS
COMPLETED
CANCELLED
NO_SHOW
DISPUTED
```

---

# 20. Outcome

Outcome is not a generic star score.

Possible dimensions:

```text
completion
punctuality
customer satisfaction
merchant satisfaction
creator satisfaction
venue satisfaction
conversion
repeat
safety
complaint
refund
attributed spend
```

Different verticals consume different dimensions.

---

# 21. Human Commercial Reputation

No permanent beauty score.

No universal person ranking.

Maintain contextual dimensions such as:

```text
Promotion reliability
Fulfillment reliability
Punctuality
Response behavior
Brand outcome
Customer repeat
Merchant repeat
Safety
Cancellation
```

Ranking must remain context-dependent.

---

# 22. Attribution

The platform must distinguish the economic source of demand.

Examples:

```text
CREATOR_OWNED
PROXY_OWNED
MERCHANT_OWNED
PARTNER_OWNED
SHARED
```

Example path:

```text
TikTok Creator post
→ Proxy link
→ Registration
→ Activity
→ Venue visit
→ Settled transaction
```

Attribution events must remain auditable.

---

# 23. EconomicEvent / Universal Ledger

The ledger is platform-wide.

Canonical event:

```text
EconomicEvent
payer
payee
gross
platform_fee
commission
merchant_subsidy
creator_bonus
discount
tax
refund
net
currency
source_object
timestamp
```

Not all money must physically flow through Proxy, but Proxy must know the economic fact when the feature depends on it.

---

# 24. Creator Economic Value

Proxy should optimize Creator long-term value, not only one-order payout.

Creator value can include:

```text
Cash earning
Saved spending through Creator privileges
Transport cost
Time cost
Repeat customer value
Brand relationship value
Future opportunity value
```

Example dashboard metric:

```text
Cash Earnings                    4.2M
Saved through Scene Benefits     1.4M
Total Creator Economic Value     5.6M
```

This is an internal / creator-facing economic model, not a guarantee of income.

---

# 25. Orchestration objective

A useful conceptual objective is:

```text
maximize
Customer Outcome
+
Creator Expected Value
+
Scene Utilization Value
+
Merchant Outcome
+
Platform Long-term Value
```

subject to:

```text
Policy
Safety
Eligibility
Availability
Budget
Time
Space Capacity
Consent
Commercial limits
```

The system must not optimize platform commission at the expense of user or Creator trust.

---

# 26. Eligibility before ranking

Pipeline:

```text
Candidate Generation
        ↓
Identity / Permission
        ↓
Capability
        ↓
Willingness
        ↓
Availability
        ↓
Scene Policy
        ↓
Safety / Qualification
        ↓
Travel / Time Feasibility
        ↓
Commercial Feasibility
        ↓
Eligible Candidates
        ↓
Ranking / Exploration
```

Hard failure never becomes a low score.

It becomes ineligible.

---

# 27. Policy Engine

Policy is server-side and shared by all clients.

Possible inputs:

```text
country
market
scene_type
work_type
age_state
identity_state
business_verification
creator_preference
time
space
safety_state
license_state
```

Example:

```text
if creator_fulfillment_enabled == false
→ no fulfillment assignment

if scene_safety_state != PASS
→ no offline assignment

if human_blackout overlaps assignment
→ block

if work_type not allowed in scene_type
→ block
```

---

# 28. Compliance architecture

Compliance must be structural.

Do not rely on changing UI wording to make a prohibited workflow appear acceptable.

The server must preserve:

```text
real business object
defined scope
identity
consent
qualification
venue truth
commercial truth
audit trail
```

KTV, nightlife, hospitality, events, or other higher-risk scene types must use explicit permitted WorkUnit / Activity / Service scopes.

A venue being eligible does not make every human-service combination eligible.

```text
Human = PASS
Scene = PASS
WorkUnit = BLOCKED
```

must remain a valid result.

---

# 29. Privacy architecture

## 29.1 Public vs private location

Public Market map may show:

```text
Experience venue
Activity venue
Allowed coarse Opportunity area
```

It must not show:

```text
Creator realtime GPS
Participant realtime GPS
Private exact address before authorization
```

---

## 29.2 Data sharing

Global server identity does not imply global partner visibility.

Partner access must be purpose-scoped.

Example:

```text
KTV SaaS may know:
- assigned Creator identity needed for execution
- arrival state
- authorized contact path

KTV SaaS may not automatically know:
- Creator's unrelated customer history
- unrelated earnings
- private relationship graph
```

---

# 30. Event model

Cross-client event schema:

```text
event_id
tenant_id
app_id
actor_id
subject_id
event_type
object_type
object_id
timestamp
channel
context
metadata
policy_version
```

Examples:

```text
HUMAN_AVAILABILITY_OPENED
SPACE_AVAILABILITY_PUBLISHED
VENUE_OFFER_SUBMITTED
DEMAND_CREATED
WORKUNIT_CREATED
ASSIGNMENT_INVITED
ASSIGNMENT_ACCEPTED
RESERVATION_HELD
CHECKIN_CONFIRMED
WORK_COMPLETED
OUTCOME_RECORDED
ECONOMIC_EVENT_POSTED
```

---

# 31. Read models

Clients should consume purpose-built read models.

Examples:

```text
CreatorAvailabilityReadModel
VenueCapacityReadModel
SceneOfferReadModel
ConsumerCompositeOfferReadModel
KTVTonightBoardReadModel
MerchantCampaignReadModel
OpsShortageReadModel
CreatorEarningsReadModel
```

Do not expose internal raw tables directly to mobile clients.

---

# 32. Core API direction

Illustrative generic endpoints:

```text
POST /commands
POST /subjects/{id}/events
GET  /subjects/{id}/state
GET  /subjects/{id}/availability

GET  /venues/{id}
GET  /venues/{id}/spaces
POST /venues/{id}/availability
POST /venues/{id}/requirements
POST /venues/{id}/offers

POST /demands
GET  /demands/{id}
POST /demands/{id}/offers

POST /matching/query
POST /assignments
POST /assignments/{id}/accept
POST /assignments/{id}/decline
POST /assignments/{id}/check-in

POST /reservations
POST /reservations/{id}/confirm
POST /reservations/{id}/cancel

POST /outcomes
POST /economic-events
```

These are platform APIs, not Proxy consumer-app-specific endpoints.

---

# 33. Prohibited architecture

Core must not contain:

```text
proxy_home_tab
proxy_market_card
proxy_creator_feed
ktv_screen_button
consumer_specific_copy
```

Core may contain:

```text
Human
Scene
Space
Availability
Demand
Offer
Assignment
Outcome
EconomicEvent
```

Client / vertical adapters translate these into UI.

---

# 34. Repository direction

```text
platform/
  identity/
  behavior/
  event-bus/
  state-engine/
  policy-engine/
  availability/
  eligibility/
  matching/
  orchestration/
  assignment/
  reservation/
  attribution/
  settlement/
  outcome/
  audit/

verticals/
  creator/
  scene/
    ktv/
    restaurant/
    event/
    studio/
  merchant/

apps/
  proxy-consumer/
  creator-web/
  venue-android/
  venue-web/
  merchant-console/
  ops-console/
```

Dependency direction:

```text
apps
 ↓
verticals
 ↓
platform
```

Platform must never import an app package.

---

# 35. Scene Pack contract

A new Scene vertical must implement a common contract.

Example:

```text
SceneTypeDefinition
SpaceTypes
CapacityModel
AvailabilityModel
ReservationRules
CommercialTermTypes
QualificationRules
CheckInRules
OutcomeSchema
```

KTV is one implementation.

Later possible packs:

```text
Restaurant
Cafe
Event venue
Photo studio
Beauty / salon
Tour
Retail activation
```

No new core marketplace architecture is required for each vertical.

---

# 36. Command Adapter contract

Every client command should resolve to one of:

```text
QUERY
CREATE
UPDATE
OFFER
RESERVE
ASSIGN
ACCEPT
DECLINE
CHECK_IN
COMPLETE
CANCEL
```

A client may present this as:

```text
chat
form
button
voice
API request
```

but the server command contract remains stable.

---

# 37. AI shell principle

The AI layer should feel broad to the user but remain narrow in authority.

```text
AI knows how to ask.
Platform knows what is true.
Policy knows what is allowed.
Orchestrator knows what can be combined.
Ledger knows what happened economically.
```

This separation is mandatory.

---

# 38. Existing Proxy Market remains frozen

No UI redesign is required in this PRD revision.

Current consumer Market remains:

```text
Experience
Opportunity
Activity
```

with:

```text
LIST / MAP
```

and persistent top-right Map action.

R15.12.10 rendering remains the baseline:

```text
Creator
+ external channel context
+ availability
+ open Experience objects
```

No duplicate social feed inside Market.

No permanent person price.

---

# 39. Feed remains separate

External social:

```text
TikTok / Instagram
= broad attention / content operation
```

Proxy Feed:

```text
Proxy-native social / relationship / local network content
```

Proxy Market:

```text
actionable supply / demand / scene / transaction objects
```

Infrastructure:

```text
server-side truth + orchestration
```

These layers must not collapse into one surface.

---

# 40. Creator does not need mandatory native app

Hard product rule:

> **Creator monetization must not require daily use of a native Proxy Creator app.**

The platform should support low-friction operations through:

```text
Link
Web
PWA
Zalo
Partner channel
Ops-assisted workflows
```

A native app may be added only when it creates real operational value.

---

# 41. Venue SaaS is allowed to be a separate product

The KTV / Venue SaaS may have:

```text
different brand
different domain
different Android package
different UX
different pricing
```

without breaking platform architecture.

It still uses:

```text
GlobalVenueId
GlobalSpaceId
GlobalPersonId
DemandId
OfferId
AssignmentId
ReservationId
EconomicEventId
```

The client is replaceable.

The truth is not.

---

# 42. SaaS business model direction

Scene SaaS can generate value from:

```text
Subscription
Transaction fee
Demand acquisition
Commission
Premium orchestration
Analytics
Operational automation
```

Pricing is not frozen in this PRD.

The strategic purpose of SaaS is more important than the initial subscription revenue:

> **Scene SaaS brings live physical inventory into the same network as Human availability.**

---

# 43. Network effects

The infrastructure should create multiple reinforcing loops.

## 43.1 Human loop

```text
More Creator supply
→ better fulfillment
→ more demand
→ more earning
→ better retention
→ more Creator referrals
```

## 43.2 Scene loop

```text
More Venue supply
→ more scene options
→ better customer conversion
→ higher utilization
→ better venue offers
→ more venues
```

## 43.3 Creator–Scene loop

```text
Better Creator network
→ venues offer better benefits
→ Creators prefer platform scenes
→ more content / customer activity
→ venue ROI improves
```

## 43.4 Data loop

```text
More execution
→ better availability truth
→ better outcome truth
→ better matching
→ better execution
```

---

# 44. Creator concentration risk

The platform should not depend structurally on a small number of individual Creators.

Monitor:

```text
share of fulfilled demand by creator
share of GMV by creator
share of a category supplied by creator
replacement depth
candidate redundancy
```

Do not punish a Creator for normal rejection.

Reduce concentration through:

```text
supply development
exploration
new Creator activation
category redundancy
scene diversification
```

---

# 45. Scene concentration risk

The same principle applies to venues.

Monitor:

```text
single venue share
single venue category share
space concentration
offer concentration
merchant dependency
```

The platform should remain useful even if one major venue leaves.

---

# 46. No anti-disintermediation-by-contract strategy

The platform should not rely mainly on banning direct relationships.

Retention comes from:

```text
new demand
scene network
availability filling
brand relationships
commercial benefits
operations
payment / settlement
attribution
trust
repeat demand
```

Creator-owned customers can have different economics from Proxy-owned demand.

The infrastructure must remain valuable even when human relationships move off-platform.

---

# 47. Merchant-negotiated Creator privileges

Proxy may negotiate network-level benefits with venues / merchants.

Examples:

```text
Creator discount
free item
priority booking
free content area
room upgrade
event access
brand sampling
```

These privileges should be managed as dynamic `CommercialTerm` objects.

Do not write every temporary deal into a long-term Creator master contract.

Do record every active term and every redeemed economic event.

---

# 48. Scene-to-Creator pricing / benefit negotiation

A venue may express:

```text
what it needs
what it pays
what benefit it offers
what time window it needs
what maximum cost / discount it accepts
```

A Creator may express:

```text
minimum compensation
scene preferences
allowed work categories
blackout
travel distance
time availability
```

The orchestrator combines these constraints.

---

# 49. Human-to-Scene matching

Example:

```text
Creator:
Chinese ✓
Reception ✓
Available 19:00–23:00
KTV scene allowed ✓
Max travel 6km

Venue:
Needs Chinese Reception ×2
20:00–23:00
Distance 3.1km
Verified ✓
Scene safety PASS
```

If all hard constraints pass:

```text
Eligible
```

Ranking then evaluates trade-offs.

---

# 50. Scene-to-Customer matching

Example factors:

```text
scene quality
price
distance
space size
available capacity
customer history
merchant reliability
special benefit
current occupancy
offer validity
```

Customer may select:

```text
Recommended
Best value
Nearest
Best environment
```

These are presentation lenses over the same eligible offer set.

---

# 51. Package confirmation protocol

A composite offer can contain dependencies that expire independently.

Before final confirmation:

```text
recheck Human availability
recheck Space availability
recheck Offer validity
recheck price
recheck policy
recheck payment state
```

Only then commit.

Use temporary holds where required.

---

# 52. Idempotency and concurrency

Every consequential write must support:

```text
idempotency_key
expected_version
actor_id
policy_version
request_id
timestamp
```

Double taps, reconnects, retries, partner API retries, or AI tool retries must not create duplicate assignments or reservations.

---

# 53. Failure states

Do not collapse every failure into “no results”.

Required distinction:

```text
NO_ELIGIBLE_HUMAN
NO_AVAILABLE_HUMAN
NO_AVAILABLE_SPACE
NO_VALID_OFFER
BUDGET_MISMATCH
POLICY_BLOCKED
PERMISSION_DENIED
SOURCE_STALE
SOURCE_UNAVAILABLE
CONFLICT
OFFER_EXPIRED
```

AI may explain the state, but must not rewrite it.

---

# 54. Clarification policy

Ask the user only when missing information materially changes execution.

Example:

```text
“今晚找KTV”
```

The system can first use:

```text
current city
current time
reasonable party default only if safely inferable
```

but must clarify genuinely required fields such as:

```text
party size
hard budget ceiling
specific restricted requirement
```

when no safe/default execution exists.

---

# 55. Observability

Track platform health across:

```text
command parse success
bound command success
truth query latency
eligible candidate count
offer response rate
assignment acceptance
reservation confirmation
conflict rate
check-in success
completion
settlement
policy blocks
manual intervention
```

---

# 56. Core operational metrics

## Human

```text
Activated Creator
Open Availability Hours
Filled Availability Hours
Creator Earnings
Creator Economic Value
90D Retention
Acceptance Rate
Completion Rate
Repeat Demand
```

## Scene

```text
Active Venues
Connected Spaces
Published Capacity
Utilized Capacity
Offer Response Rate
Reservation Conversion
Scene Repeat
Venue Retention
```

## Orchestration

```text
Time to First Eligible Option
Time to Fill
Package Confirmation Rate
Conflict Rate
Manual Intervention Rate
Outcome Success
```

## Economics

```text
GMV
Contribution Margin
Creator Payout
Merchant Subsidy
Scene Commission
Take Rate
Refund
CAC Payback
```

---

# 57. P0 implementation sequence

## Phase 0 — Canonical Truth Foundation

Build / freeze:

```text
Human
Venue
Space
Availability
Demand
Offer
Assignment
Reservation
Outcome
EconomicEvent
```

Do not start with complex recommendation ML.

---

## Phase 1 — Command Layer

Connect existing Home input to:

```text
Intent
→ Bound Command
→ Platform Query / Action
```

Support first commands:

```text
find scene
publish scene capacity
find human
open human availability
create requirement
submit offer
```

---

## Phase 2 — KTV Scene SaaS P0

Build:

```text
Android / Web login
Room board
Availability
Requirement
Offer
Check-in
Completion
```

All writes go to Core.

No private KTV database of Creator truth.

---

## Phase 3 — Human + Scene orchestration

Support:

```text
Demand
→ Venue candidates
→ Human candidates
→ Composite offer
→ Reservation + Assignment
```

---

## Phase 4 — CommercialTerm + Ledger

Support:

```text
discount
commission
Creator benefit
merchant subsidy
Creator payout
platform fee
refund
```

---

## Phase 5 — Attribution + optimization

Only after enough real execution data:

```text
source attribution
scene conversion
creator value
merchant ROI
dynamic recommendation
```

---

# 58. P0 command acceptance examples

The system should eventually pass examples such as:

### Consumer

```text
今晚8点6个人，D1附近找KTV，预算5M。
```

Expected:

```text
live eligible venue options
space availability
price
offer validity
```

### Scene

```text
今晚10点以后有5个空包，最多让15%。
```

Expected:

```text
space supply updated
commercial term created
available to matching
```

### Creator

```text
周五18点到23点有空。
```

Expected:

```text
availability state updated
conflict checked
eligible opportunities discoverable
```

### Business

```text
周六开业，需要4个宣发、4个现场。
```

Expected:

```text
campaign decomposed
WorkUnits created
candidate generation starts
```

---

# 59. Architecture acceptance gates

A release fails if any of these are true:

1. KTV client stores a separate authoritative Creator list.
2. Consumer app stores a separate authoritative Venue availability.
3. Two clients can allocate the same exclusive Human time without conflict detection.
4. Two clients can reserve the same exclusive Space without conflict detection.
5. AI can invent a price or availability and write it as truth.
6. Venue ranking is determined only by platform commission.
7. Scene Policy can be bypassed by another client.
8. Creator realtime GPS is publicly exposed.
9. Temporary commercial terms are used without an auditable server record.
10. Core imports Proxy consumer UI or KTV-specific screen logic.
11. Partner API bypasses eligibility / policy.
12. A Creator must install the consumer app to monetize.
13. Market UI duplicates the Feed again.
14. Map toggle disappears from the frozen Market contract.

---

# 60. Non-goals

This revision does not attempt to build:

```text
a universal workforce platform for every industry
a full ERP
a full POS
a generic hotel PMS
a TikTok competitor
a KTV consumer review app
a beauty ranking market
a public realtime people map
a pure lowest-price auction
```

The first vertical remains:

```text
Creator + Local Scene
```

KTV is the first Scene Pack used to validate real-world space orchestration.

---

# 61. Strategic expansion rule

Do not generalize by imagination.

Generalize only after a vertical has produced repeated real transactions.

The extraction rule is:

```text
If a capability is repeatedly needed by KTV + Restaurant + Event
→ move it toward Platform Core

If it exists only for KTV
→ keep it in KTV Scene Pack
```

---

# 62. Infrastructure maturity path

```text
Stage 1
Proxy operates its own Creator supply

Stage 2
Proxy connects Creator + consumer + merchant

Stage 3
Venue SaaS contributes live scene inventory

Stage 4
Third-party demand and scene systems connect through API

Stage 5
Multiple apps consume the same Human / Scene / Commerce truth

Stage 6
Proxy becomes an invisible orchestration layer behind other businesses
```

Infrastructure status should be judged by dependency, not branding.

> **When another business can replace its frontend but still cannot easily replace the orchestration truth layer, Proxy is becoming infrastructure.**

---

# 63. Final product definition

Consumer-facing explanation can remain simple.

Internally the platform definition is:

> **Proxy turns fragmented human capability, creator availability, venue capacity, time windows, physical spaces and commercial demand into a real-time, policy-governed, auditable transaction network.**

For the Creator vertical:

> **Proxy helps Creators convert fragmented time, influence and capability into more stable income by connecting them to demand, scenes, benefits and operations.**

For Scene SaaS:

> **Proxy helps venues convert idle physical capacity and staffing gaps into executable demand and commercial offers.**

For the platform:

> **Human × Scene × Time × Space → Offer → Assignment / Reservation → Outcome → Settlement.**

---

# 64. One-line architecture freeze

> **AI is the shell. Command is the entry. Server is the truth. Human and Scene are equal resources. Time and Space are schedulable state. Orchestration creates the transaction.**

---

# 65. Version relationship

This PRD does **not** replace the frozen consumer UI semantics from R15.12.10.

It adds the infrastructure contract underneath them.

```text
R15.12.10
Consumer UX baseline
Experience / Opportunity / Activity
LIST / MAP
Creator Availability Market

        ↓ consumes

PRD v1.4
Human × Scene × Time × Space Infrastructure
Unified Command Surface
Scene SaaS
Canonical Truth
Orchestration
CommercialTerm
Attribution
Ledger
```

The next prototype change should be triggered only by a real consumer UX requirement.

The infrastructure work can proceed without redesigning the current prototype.
