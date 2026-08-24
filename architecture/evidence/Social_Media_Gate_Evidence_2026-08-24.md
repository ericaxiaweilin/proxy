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

## Physical device state

- Connected target: `weilin`, iPhone 15, iOS 26.6, CoreDevice ID `5F487B76-69EA-5311-AE63-3C5F09A61F20`.
- Current Proxy bundle launched successfully: `com.proxy.creator.dev.c4673fy8u7`.
- Automated screenshot capture was denied by iOS (`SecureStartService com.apple.mobile.screenshotr: 0xe8000022`), so physical-device visual evidence remains open.

## Open blockers

- Gate 3 still needs licensed half-body/full-body/edge-subject portrait screenshot coverage, mixed image/video coverage, a small-iPhone run and Android evidence.
- The automation driver could navigate the native gallery but did not dispatch its close-button tap. The close control now has an expanded hit target and touch-down fallback; manual physical-device confirmation remains required before Gate 3 release.
- Gate 4 still needs resumable multipart pause/resume and drag reordering before full release.
- Model classification was unavailable because the external model-stack control plane at `100.96.188.77:14041` timed out. Media publication correctly continued without binding a business-side model.
