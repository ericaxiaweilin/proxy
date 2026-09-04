# Reality Scene location pipeline

The production flow has one direction:

`temporary precise-location consent → device fix → authenticated nearby query → PostgreSQL scene catalog → distance/popularity ranking → map/list → private visit timestamp`

## Invariants

- `reality.scenes` is the production catalog source. Mobile code must not ship a
  second scene list or a fixed total.
- Nearby queries require an authenticated account and an active `PRECISE_GPS`
  consent. Coordinates travel in an authenticated POST body so access logs do
  not capture them; they are used for the query and are not persisted.
- Recommendations are limited by radius, then ranked by scene quality,
  aggregate popularity signals and distance.
- A private footprint belongs only to the authenticated account. Its
  `visited_at` timestamp is server-owned and never becomes a public live
  location signal.
- The Footprints filter is a timeline: newest `visited_at` first.

The durable regression contract is `UI-SCENE-MAP-001` in
`scripts/check-regression-contracts.sh`.
