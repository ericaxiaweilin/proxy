# Proxy UI Foundation v1

Source package reviewed on 2026-09-08:

- `UPSTREAM.md` — BoardUI MIT component references.
- `ADOPTION_MAP.md` — allowed adoption boundary.
- `proxy-tokens.css` — portable semantic tokens.
- `index(7).html` — interactive component reference.

## Production boundary

BoardUI is an engineering reference for accessible control state. Proxy keeps
its own identity and product objects. Do not adopt the BoardUI app shell,
dashboard structure, consumer sidebar, chart-heavy Home, agent-chat language,
or carousel recommendations.

Shared production controls live in
`apps/mobile/src/components/proxy-foundation.tsx`. Semantic aliases live in
`apps/mobile/src/theme.tsx` under `foundation`. The aliases intentionally map
portable roles onto the active Proxy R3 palette rather than replacing R3.

## Adopted now

- Market opportunity/activity tabs use `ProxyTabs`.
- Conversation no-forward and Settings screenshot-warning use `ProxySwitch`.
- Shared primitives are available for avatar, primary/secondary/ghost/danger
  buttons and circular icon buttons.

## Product invariants

- Human and AI accounts stay circular identity nodes, never commodity cards.
- Scene, Moment, Human Node, Invite, Opportunity, Scene Care and Creator remain
  Proxy product components; foundation controls cannot redefine them.
- Consumer mobile selection remains a sheet or lightweight segmented filter.
- Secure labels describe implemented behavior only; never claim screenshots
  can be technically prevented.
