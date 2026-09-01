# Cloudflare edge target architecture

Status: approved migration target. This is an incremental architecture, not a
rewrite and not permission to move canonical data into caches.

## Data placement

| Data | Current truth | Cloudflare target | Consistency |
|---|---|---|---|
| Posts, users, orders, payments, creator supply | PostgreSQL | PostgreSQL through Hyperdrive first; consider D1 only through a separately rehearsed migration | transactional / read-your-writes |
| Feed pages | PostgreSQL projection | cacheable Worker GET projection; optional D1 read projection with Sessions bookmarks | ordered, monotonic per reader |
| Photos, videos, audio, derived variants | local immutable object root | R2 + custom-domain Worker/Cache API | immutable key + checksum |
| Booking capacity, invitation acceptance, room/chat coordination | PostgreSQL today | Durable Object per coordination key, with durable storage and an outbox back to canonical records | strongly serialized per key |
| Feature flags, public configuration, routing hints | process environment | Workers KV | eventually consistent; never transaction truth |
| Media processing, notification, indexing, projection refresh | PostgreSQL outbox/worker | Cloudflare Queues consumers with inbox dedupe | at-least-once + idempotent consumer |

## Request paths

```text
Mobile/Web
  -> Cloudflare Worker (auth boundary, rate limit, stable API)
     -> Cache API -> public GET /v1/feed pages
     -> R2 -> immutable media ranges and posters
     -> Hyperdrive -> existing PostgreSQL canonical services/read models
     -> Durable Object -> booking/chat/invitation coordination only
     -> Queue -> media, notification, index and projection work
```

The current Go service remains the canonical command/orchestration origin during
migration. Workers front it and gradually absorb stateless read projections.
The Go process is not forced into a Worker runtime.

## Contracts already prepared

- Public timeline now has a cacheable `GET /v1/feed?limit=&cursor=` projection.
- Feed order is `(created_at DESC, id ASC)` and uses an opaque cursor, never an
  offset. New posts therefore do not shift old pages or create duplicate rows.
- Mobile performs infinite append and persists successful pages locally.
- One feed page performs one media-asset batch query plus one variant batch
  query instead of N+1 queries.
- Media routes expose Range, HEAD, ETag and explicit cache policy.
- Posts reference stable media asset IDs; no R2 bucket URL enters post rows.

## Edge cache rules

- Cache anonymous public GET projections only. Never cache command POSTs,
  authentication, private/follower feeds, orders, wallet, or availability writes.
- Include projection version, normalized query, locale and authorization class in
  cache keys. Do not include unstable signed R2 URLs.
- Serve stale public feed pages during short origin outages; surface freshness
  metadata and refresh asynchronously.
- Purge by projection tag/event, not by deleting canonical rows.

## Migration gates

1. R2 dual-write and checksum audit reaches 100% for originals and derivatives.
2. Worker public feed shadow response matches Go response: IDs, order, media IDs,
   visibility and cursor continuation.
3. Hyperdrive/D1 read path demonstrates read-your-writes behavior for the chosen
   consistency boundary.
4. Queue consumers pass duplicate, reordering, retry and dead-letter tests.
5. Durable Object restart test proves accepted booking/invitation state survives
   eviction and deployment.
6. Origin outage test: cached public feed and cached R2 media remain readable;
   private mutations fail closed and retry safely.
7. Rollback changes routing only. It must not rewrite posts, orders or media IDs.
