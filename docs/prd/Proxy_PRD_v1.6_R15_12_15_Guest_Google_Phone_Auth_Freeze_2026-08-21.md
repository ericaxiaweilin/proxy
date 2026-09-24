# Proxy PRD v1.6 — R15.12.15 Guest + Google + Phone Identity Entry Freeze

**Date:** 2026-08-21  
**Status:** IDENTITY ENTRY FREEZE / GUEST MODE FREEZE / GOOGLE + PHONE P0 AUTH FREEZE  
**Inherits:** `Proxy_PRD_v1.5_R15_12_12_Home_Creator_Liquidity_Freeze_2026-08-20.md`  
**Prototype:** `Proxy_P0_Prototype_R15_12_15_Guest_Google_Phone_Login.html`

This patch changes only the **entry / authentication / account-upgrade layer**.  
All previously frozen Home, Market, Experience / Opportunity / Activity, Creator liquidity, Scene, scheduling, transaction, policy and ledger rules remain unchanged unless explicitly overridden below.

---

# 0. Executive Freeze

P0 authentication is intentionally narrow:

```text
Google
Phone + OTP
Guest
```

Do **not** expose Email, TikTok, Zalo, WeChat or other providers in the P0 consumer login UI yet.

The product rule is:

> **A user may use Proxy without registering an account, but the platform must never operate without an internal principal / person / device / session identity.**

The second hard rule is:

> **Login upgrades identity; it must not create a second person.**

---

# 1. First-launch UX

Frozen first-launch flow:

```text
Splash
  ↓
Login / Register Proxy
  ├── Continue with Google
  ├── Vietnam phone (+84) → OTP
  └── Continue as Guest
          ↓
         Home
```

## 1.1 Splash

Splash is a brand surface, not an App Icon surface.

Frozen visual:

```text
White background
+
White / transparent otter body
+
Black outline
+
Proxy wordmark
```

Do not place the otter inside a black rounded square.

Hard rule:

> **App Icon may have a container. Splash Brand Mark does not.**

---

# 2. Login / Register screen

The same screen handles login and registration.

Do not ask the user to choose “Login” versus “Register” first.

Title:

> **继续使用 Proxy**

P0 visible methods:

1. `使用 Google 继续`
2. Vietnam phone input with `+84`
3. `暂不登录，直接使用 Proxy`

Do not show:

```text
Email
TikTok
Zalo
WeChat
Password
Username
```

These can be added later without changing the identity core.

The screen must remain quiet and model-native. No advertising carousel, no account-benefit essay and no provider grid.

---

# 3. Guest Mode

Guest Mode is a supported product state.

It is **not**:

```text
no identity
no session
untracked arbitrary client
```

It is:

```text
Anonymous Principal
      ↓
GlobalPersonId
      ↓
Device
      ↓
Session
```

No recoverable login credential is bound yet.

Recommended state name:

```text
ANONYMOUS
```

Do not use `NO_USER` as the domain state.

## 3.1 Guest permissions — P0

Guest may:

```text
Open Home
Use basic AI
Browse Market
Browse Experience / Opportunity / Activity
Read Feed
View Creator / Business public profiles
Search
Use local market / location context
```

Account upgrade is required before durable or accountable network actions, including:

```text
Post / Comment / Proxy-native Share
Message another person
Join or create Activity
Create Opportunity
Book / Order
Pay
Cloud-synced Follow / Save
Creator monetization
Business operations
```

Commercial / higher-risk capabilities may require stronger verification beyond login.

---

# 4. Identity state model

Frozen product-level states:

```text
ANONYMOUS
REGISTERED
VERIFIED
COMMERCIAL_VERIFIED
```

Meaning:

### ANONYMOUS
Device-bound Proxy user with `GlobalPersonId`, Device and Session; no recoverable credential.

### REGISTERED
At least one recoverable authentication method is bound:

```text
Google ExternalIdentity
or
Phone Credential
```

### VERIFIED
Additional legal / age / identity verification required by a specific regulated capability.

### COMMERCIAL_VERIFIED
Creator / Business / payout / merchant or other commercial verification has passed the relevant policy.

Hard rule:

> **Authentication state ≠ legal identity verification ≠ commercial verification.**

Google OAuth is not KYC.  
Phone OTP proves control of a phone number; it is not automatically full legal identity verification.

---

# 5. Canonical identity architecture

Do not make OAuth Provider the user truth.

Canonical structure:

```text
GlobalPersonId
│
├── DeviceIdentity
├── Session
├── Google ExternalIdentity       [optional]
├── Phone Credential              [optional]
├── Verification                  [optional]
└── CommercialIdentity            [optional]
```

Provider examples:

```text
GOOGLE
PHONE
```

Future providers may be added later:

```text
ZALO
TIKTOK
WECHAT
EMAIL
```

without changing `GlobalPersonId`.

Hard rule:

> **Person is the durable identity root. Credentials are ways to regain access to that person.**

---

# 6. Guest → Account upgrade

The upgrade path must preserve all legitimate guest state.

Example:

```text
Guest
GlobalPersonId = P_8F21
Device = D_102
Session = S_77
        ↓
Google authorization succeeds
        ↓
ExternalIdentity(
  provider = GOOGLE,
  provider_subject_id = ...
)
        ↓
bind to P_8F21
        ↓
state = REGISTERED
```

Preserve, subject to retention / privacy policy:

```text
AI conversation state
Market history
Local preferences
Drafts
Saved local context
Attribution
Relevant behavioral history
```

Do not create a new person merely because the credential is new.

---

# 7. Existing-account collision / merge

A critical P0 backend case:

```text
Guest P_TEMP
        ↓
Google / Phone credential
        ↓
credential already belongs to P_EXISTING
```

Expected result:

```text
Authenticate P_EXISTING
Attach current device/session to P_EXISTING
Migrate only eligible guest-local state
Do not create duplicate account/person
Do not silently merge conflicting regulated/commercial records
```

The server is the authority for merge policy.

The client must not attempt identity merging itself.

---

# 8. Google — P0

Consumer UI exposes:

> `使用 Google 继续`

Flow:

```text
Proxy
↓
Google official OAuth / Identity flow
↓
authorization result / token or code
↓
Proxy server validation
↓
ExternalIdentity bind / reuse
↓
Proxy session
```

Do not implement a fake Google credential form inside Proxy.

Until Google App configuration is ready, the prototype may **simulate the callback only**, with a visible prototype note.

Production requires the real Google SDK / official authorization surface and server-side validation.

---

# 9. Phone — P0

Vietnam-first UI:

```text
+84 | phone number
```

Flow:

```text
Enter phone
↓
Request OTP challenge
↓
Enter OTP
↓
Server verifies challenge
↓
Create or reuse Phone Credential
↓
Create / reuse registered identity
↓
Proxy session
```

Client must not use hardcoded IDs such as:

```text
user_001
login_001
```

The server creates / resolves identity from the verified challenge.

P0 OTP screen:

```text
6 digits
Resend
Change phone number
Continue
```

Rate limiting, abuse protection, expiry, retry limit and provider delivery truth belong to the backend / auth service.

---

# 10. Launch persistence

Guest choice should persist.

After the user explicitly selects Guest:

```text
next normal launch
→ Home
```

Do not force the login page on every startup.

The login page appears again when:

```text
user explicitly opens Sign in
or
an account-required action is requested
or
session / security policy requires re-authentication
```

---

# 11. Contextual upgrade gate

Account upgrade should happen at the moment responsibility is needed.

Example:

```text
Guest browses Activity
↓
taps “参加”
↓
Proxy explains minimally:
“继续参加需要保存你的身份与联系方式”
↓
Google / Phone
↓
return to the same Activity
```

Do not discard the original user intent after authentication.

Hard rule:

> **Auth is an interruption, not a new workflow. Return the user to the interrupted action.**

---

# 12. P0 UI freeze

This version changes only:

```text
Splash brand mark
Auth choice screen
Google prototype handoff
Phone entry
OTP entry
Guest continuation
```

It does **not** change:

```text
Home layout
Home Experience / Opportunity / Activity controls
Market taxonomy
Feed structure
Creator profile model
Scene model
Transaction model
```

---

# 13. P0 acceptance gates

R15.12.15 is accepted when:

- Splash has no black rounded-square background.
- Login screen exposes only Google, Phone and Guest.
- Google path is clickable and clearly marked as prototype until official OAuth config exists.
- Phone path supports `+84 → OTP → success` interaction.
- Guest reaches Home without account registration.
- Login / registration use one unified entry.
- No hardcoded `user_001/login_001` identity is introduced.
- Guest → Google / Phone is modeled as identity upgrade.
- Existing credential collision resolves to the existing person rather than duplicating identity.
- Home `体验 / 机会 / 活动` remains unchanged.
- Existing Home voice and photo / camera input controls remain unchanged.
- Other previously frozen surfaces remain untouched.

---

# 14. Next auth work — explicitly not in this patch

Do one provider at a time.

After Google + Phone are integrated and stable, evaluate separately:

```text
Zalo
TikTok
WeChat
Email
```

No provider should be added merely to fill the login screen.

> **P0 principle: fewer identity methods, stronger identity truth.**
