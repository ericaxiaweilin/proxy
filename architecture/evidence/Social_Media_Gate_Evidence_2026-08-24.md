# Social Media Gate Evidence — 2026-08-24

Scope: Gate 3 Feed/Gallery and Gate 4 Composer on the local P0 stack.

## Automated contracts

- `pnpm --filter @proxy/mobile typecheck`: passed.
- `pnpm --filter @proxy/mobile test`: 21 files / 61 tests passed.
- Real command replay: first `CreatePost` returned `ACCEPTED`; the identical envelope returned `ALREADY_APPLIED`; both returned Post `post_498411d9d6da8bebb82e9dff`.

## iPhone 15 simulator flow

- Target: `Proxy iPhone 15 QA`, iOS 26.5, UDID `22280AEA-3B36-4499-81EC-A1D77C712BA9`.
- Entered as guest, opened Dynamic, opened the inline composer, granted Photos access and selected three source photos.
- Composer restored the selected sources from its durable draft directory and displayed them in a horizontal preview rail.
- Publishing locked the submit action and exposed per-item cancel actions while uploads were active.
- API accepted one Post: `post_1a62d1acf97458e3e3b419a3`.
- Durable worker reported `media processing batch completed: count=3`.
- Feed hydrated the published Post with three READY media items and displayed the `1/3` rail index.
- Gallery opened from media 1 and navigated to media 2 with a horizontal gesture; counter changed to `2/3`.

## Portrait composition regression

- Test assets are synthetic QA fixtures, not user photos and not product/brand assets:
  - `architecture/fixtures/social-media/synthetic-half-body-4x5.jpg` — 1122×1402, SHA-256 `650e3e68c0f5ac957d221613e38e24c3ae8c7454df97bcdb2df72de1597531b2`.
  - `architecture/fixtures/social-media/synthetic-full-body-9x16.jpg` — 941×1672, SHA-256 `52054421a5ae1f61e40dc1d8efe174d6cc45295b42ea9bb227ad60a2d451ce6b`.
- Generation intent: a realistic adult Vietnamese woman, one seated half-body 4:5 cafe portrait and one standing full-body 9:16 West Lake portrait, with the full head, hands, legs and shoes visible so destructive cropping is detectable.
- Selected both images in one inline-composer draft, with the half-body image first and full-body image second.
- API created Post `post_45ca5b5f18da5f06659d89cc`; the worker reported `media processing batch completed: count=2`.
- Feed preserved author order and reported `1/2` then `2/2` after a horizontal gesture.
- The 4:5 item filled the portrait rail without cutting the head, chin or hands.
- The 9:16 item used contain treatment inside the stable portrait canvas; head and shoes remained visible and the rail height did not jump.
- Gallery opened directly on item `2/2` and restored the uncropped 9:16 source composition.
- Visual evidence:
  - `architecture/evidence/social-media-2026-08-24/portrait-feed-half-body.jpg`
  - `architecture/evidence/social-media-2026-08-24/portrait-feed-full-body.jpg`
  - `architecture/evidence/social-media-2026-08-24/portrait-gallery-full-body.jpg`

## Physical device state

- Connected target: `weilin`, iPhone 15, iOS 26.6, CoreDevice ID `5F487B76-69EA-5311-AE63-3C5F09A61F20`.
- Current Proxy bundle launched successfully: `com.proxy.creator.dev.c4673fy8u7`.
- Automated screenshot capture was denied by iOS (`SecureStartService com.apple.mobile.screenshotr: 0xe8000022`), so physical-device visual evidence remains open.

## Open blockers

- Gate 3 still needs multi-person/edge-subject portrait screenshot coverage, mixed image/video coverage, a small-iPhone run and Android evidence. The half-body/full-body mixed portrait case is now covered with synthetic fixtures and simulator evidence.
- The automation driver could navigate the native gallery but did not dispatch its close-button tap. The close control now has an expanded hit target and touch-down fallback; manual physical-device confirmation remains required before Gate 3 release.
- Gate 4 still needs resumable multipart pause/resume and drag reordering before full release.
- Model classification was unavailable because the external model-stack control plane at `100.96.188.77:14041` timed out. Media publication correctly continued without binding a business-side model.
