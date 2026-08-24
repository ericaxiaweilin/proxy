# Proxy PRD v1.8 — R15.12.17 Voucher Product & Visual System Freeze

**Date:** 2026-08-21  
**Status:** VOUCHER PRODUCT / VISUAL / REDEMPTION / SETTLEMENT FREEZE  
**Inherits:** `Proxy_PRD_v1.7_R15_12_16_Voucher_Infrastructure_Freeze_2026-08-21.md`  
**Interactive Prototype:** `Proxy_Voucher_Prototype_R15_12_17_2026-08-21.html`

This revision does not change the Voucher Core economics introduced in v1.7.  
It refines the product into a platform-level voucher system with a consistent visual identity, less redundant copy, and clearer separation between **voucher surface**, **marketing context**, **redemption truth**, and **settlement truth**.

---

# 0. Product Freeze

P0 voucher families:

```text
COFFEE VOUCHER
EXPERIENCE VOUCHER
ACTIVITY VOUCHER
```

They all use the same Voucher Core.

The card is not a marketing poster.

> **Voucher card = entitlement identity + value + scope + validity.**

Marketing copy, inviter identity, CRM relationship and acquisition attribution must not crowd the card.

---

# 1. Card information hierarchy

## 1.1 Required on compact voucher card

```text
voucher family
visual mark / category icon
display value
primary redeem object / merchant
location or short scope
valid_until
```

Example:

```text
COFFEE VOUCHER

[Coffee Mark]

50,000 VND

Cafe A
Bắc Ninh

Valid until 08/31
```

Do not default to:

```text
“一杯咖啡”
“Mai 邀请你”
“这是送给你的……”
```

Those may exist in the message / campaign / CRM event that delivered the voucher, but not as mandatory voucher-face copy.

Hard rule:

> **Invitation belongs to conversation context. Voucher belongs to entitlement context.**

---

# 2. Platform-level visual system

Voucher families must be recognizable across all issuers.

Issuer branding can appear only as secondary information.

P0 family visual language:

```text
Coffee      → warm neutral / coffee brown
Experience  → restrained green
Activity    → warm sand / amber
```

The family icon is the stable recognition element.

Do not use emoji as the production voucher logo.

Use a consistent vector icon system:

```text
Coffee      → cup / steam
Experience  → landscape / path / discovery mark
Activity    → people / movement / participation mark
```

Visual rules:

- large whitespace
- one dominant amount
- one family mark
- no advertising banner
- no coupon-wall density
- no fake ticket perforation unless it serves an interaction
- no unnecessary gradients across dozens of merchants
- issuer logos are optional, small and secondary
- Proxy controls category iconography and card structure

---

# 3. Voucher naming

Default public naming:

```text
Coffee Voucher
Experience Voucher
Activity Voucher
```

Localized labels may be:

```text
咖啡券
体验券
活动券
```

Do not require custom marketing titles for every voucher.

A specific Experience can still display its redeem object:

```text
EXPERIENCE VOUCHER
299,000 VND
Rooftop Photo Walk
Hanoi
```

---

# 4. Where inviter / issuer appears

`inviter`, `issuer`, `campaign_source`, and `attribution_source` remain first-class backend fields.

They are displayed contextually.

## 4.1 Chat delivery

Example:

```text
Mai sent you a Coffee Voucher
[Voucher Card]
```

The card itself does not repeat:

```text
Mai invited you
```

## 4.2 CRM timeline

Example:

```text
2026/08/21
Mai → David
Coffee Voucher
claimed
```

## 4.3 Voucher detail

Issuer may appear in a secondary “Issued by” row when relevant.

## 4.4 Merchant voucher

Merchant name can appear prominently when the merchant itself is the redemption scope.

---

# 5. Compact card vs detail

Compact card should answer only:

```text
What is it?
How much value?
Where / what can I use it for?
When does it expire?
```

Voucher detail handles:

```text
merchant scope
experience scope
time window
minimum spend
claim limit
voucher ID
issuer
rules
reservation requirement
redemption instructions
```

Do not duplicate full rule text on every compact card.

---

# 6. My Vouchers

P0 path:

```text
Me
→ Gifts / Vouchers
```

Tabs:

```text
Available
Used
Expired
```

Card families share one component system.

Do not create separate “Coffee Center”, “Experience Coupon Center”, etc.

---

# 7. Voucher Detail

Required sections:

```text
Voucher family
display value
category icon

redeem scope
validity
redeem time window
minimum spend
usage limit
voucher ID

concise rules
primary action
```

Primary actions:

```text
Coffee Voucher      → Use Voucher
Experience Voucher  → Choose Time / Reserve
Activity Voucher    → Join / Reserve
```

---

# 8. Redemption UX

Redemption must use a short-lived dynamic token where practical.

Example:

```text
User opens voucher
↓
Use Voucher
↓
dynamic QR / one-time code
↓
Merchant confirms
↓
RedemptionReceipt
```

The dynamic code must:

```text
expire quickly
be bound to voucher_id
be bound to merchant / redemption scope
be single-use
be replay protected
```

The consumer UI must not expose internal fraud scoring.

---

# 9. Redemption truth

Redemption is an evidence-backed event.

```text
CLAIMED
≠
RESERVED
≠
REDEEMED
≠
SETTLED
```

A QR scan alone is not enough to create final economic truth.

Possible redemption evidence:

```text
merchant confirmation
reservation_id
order_id
dynamic token validation
customer presence / check-in event
eligible item / Experience
time eligibility
merchant terminal identity
```

---

# 10. Settlement Gate

After a voucher becomes `REDEEMED`:

```text
REDEEMED
↓
RISK_CHECK
↓
SETTLEMENT_ELIGIBLE
or
SETTLEMENT_HELD
↓
SETTLED
```

`SETTLEMENT_HELD` is not an accusation. It is an economic state:

> Redemption exists, but the platform does not yet accept it as payable truth.

---

# 11. Anti-arbitrage P0

The voucher subsystem must be built assuming attempts to farm subsidies.

Minimum monitored patterns:

```text
multi-account claims
same-device account farms
same recipient set repeatedly receiving issuer-funded vouchers
Creator ↔ customer repeated circular redemptions
Merchant ↔ customer fake redemptions
Merchant ↔ Creator collusion
high redemption velocity
same terminal bulk redemption
redemption without corresponding order / check-in evidence
impossible geography / timing
resale / transfer attempts
new-user voucher farming
```

Risk decisions may use model assistance but payment holds require deterministic policy and evidence.

---

# 12. Issuer create flow

P0 issuer roles:

```text
PROXY
CREATOR
AGENT
MERCHANT
```

One Create Voucher UI is reused.

Fields:

```text
voucher family
display value
quantity
valid_from
valid_until
redeem scope
time window
audience
per-person claim limit
minimum spend
```

Issuer may see estimated budget before creation.

---

# 13. Issuer freedom vs platform control

Issuer controls:

```text
value
quantity
dates
eligible scene / Experience
target audience
time window
minimum spend
copy
```

Proxy controls:

```text
cash conversion
withdrawal
resale
transferability
voucher-to-voucher purchase
claim limits
issuer quota
evidence requirements
risk checks
settlement Gate
refund / expiry policy class
```

Frozen principle:

> **Issuer defines the commercial offer. Proxy defines economic truth.**

---

# 14. Economic model

Do not collapse economics into a single `amount`.

Required:

```text
display_value
settlement_value
proxy_funding
creator_funding
merchant_funding
brand_funding
customer_paid
```

Example:

```text
display_value       50K
settlement_value    30K

creator_funding     10K
merchant_funding    10K
proxy_funding       10K
```

The customer sees the entitlement value.  
The ledger sees who actually funds it.

---

# 15. Expiry

The UI may show a simple:

```text
Valid until 08/31
```

Backend keeps:

```text
valid_from
valid_until
expiry_policy_class
```

P0 Promotional / Issuer-funded:

```text
expired → EXPIRED
no cash redemption
unused issuer budget released according to funding policy
```

Future customer-purchased gift cards must have a separate legal / refund design.

---

# 16. No cash-equivalent behavior

P0 hard defaults:

```text
cash_convertible = false
withdrawable = false
change_given = false
can_buy_voucher = false
transferable = false
resale_allowed = false
```

Do not expose configuration toggles for these to Merchant / Creator / Agent.

---

# 17. Experience Voucher boundary

Experience Voucher must redeem against a defined lawful Experience.

Allowed:

```text
Rooftop Photo Walk
Cafe Social
Photography Session
Beauty Experience
Local Activity
```

Not allowed as a voucher object:

```text
Person
Girl
Host for N hours
Private companionship
```

The Host may be selectable or assigned, but is not the voucher object.

---

# 18. CRM integration

Voucher remains a CRM action.

Example:

```text
Customer = David
relationship = Online Warm
location = Bắc Ninh

Recommended:
Coffee Voucher
expected platform settlement cost = 30K
```

But the voucher card itself remains clean.

CRM stores:

```text
who sent it
why it was sent
campaign
relationship state
claim
redeem
next action
attributed spend
```

---

# 19. Scene integration

Merchant / Scene can use Voucher to shape demand into under-utilized time.

Example:

```text
Cafe A
weekday 14:00–18:00
capacity underused

Coffee Voucher
50K display value
valid only 14:00–18:00
```

This is `Demand Shaping`, not just discounting.

---

# 20. Reporting

Minimum issuer reporting:

```text
Issued
Claimed
Reserved
Redeemed
Expired
Settlement Held
Settled

Claim rate
Redemption rate
Settlement cost
Attributed spend
Second interaction
Paid conversion
90D repeat
```

For Proxy-funded vouchers:

```text
voucher CAC
incremental gross spend
repeat customer value
fraud loss
subsidy efficiency
```

---

# 21. P0 screens

Freeze the following screens:

```text
My Vouchers
Voucher Detail
Redeem Voucher
Create Voucher
Settlement Status
Redeem Success
```

These are represented in the R15.12.17 interactive prototype.

---

# 22. Visual acceptance gate

A voucher card is accepted only if:

- the family is identifiable without reading long copy;
- the amount is the strongest information;
- redemption scope is clear;
- expiry is visible;
- no mandatory inviter sentence appears on the card;
- no emoji is used as the production family logo;
- rules are not allowed to overwhelm the compact card;
- merchant branding does not fragment the platform visual system.

---

# 23. Functional acceptance gate

R15.12.17 is accepted when:

- Coffee / Experience / Activity share one Voucher component family.
- Issuer can configure value, quantity, dates and redeem scope.
- Non-cash rules cannot be overridden by issuer.
- Dynamic redemption token can expire and be single-use.
- Claimed / Redeemed / Settled are separate states.
- Redemption may enter Settlement Hold.
- Economics separate display value and settlement value.
- CRM attribution is preserved without polluting the card face.
- Voucher cannot become general stored value.
- Experience Voucher remains tied to an Experience, not a person-time listing.

---

# 24. Product principle

> **The card proves entitlement. The conversation explains why it was sent. The ledger proves who paid. The evidence proves whether it happened.**

And:

> **The cleaner the card, the stronger the infrastructure.**
