# Media storage baseline and R2 migration

Status: implementation baseline. The database owns media metadata and post
ordering; object storage owns bytes only.

## Invariants

1. Posts store `mediaAssetId` values, never filesystem paths, R2 URLs, signed
   URLs, or CDN URLs.
2. Clients only receive stable Proxy routes (`/v1/media/play/:id`,
   `/v1/media/thumb/:id`, recipe-versioned `/v1/media/variant/:id`).
3. `ORIGINAL` objects are immutable. Reprocessing creates a new derivative key;
   it never overwrites the upload.
4. API, worker, model/vision adapter, audit jobs, and backup jobs must resolve the
   same store configuration. No component may guess a relative `media_store`.
5. A post remains in the timeline when media delivery is temporarily unhealthy.
   The client renders cached text/poster state and retries media independently.
6. Video delivery must preserve byte ranges, ETag validation, content type, and
   cache headers. A media failure must not restart or blank the feed.

## Current local baseline

- `PROXY_MEDIA_STORE_DIR` is the only override.
- Without an override, all processes use the absolute non-iCloud directory
  `~/Developer/kake-data/media_store`.
- Startup creates the directory and performs a write + fsync + delete probe.
- `/health/ready` fails when the configured media root disappears.
- API and worker fail fast if they cannot use the same root.

## R2 target

R2 is an S3-compatible object implementation behind the media storage port; it
does not enter the social or post domain model.

Recommended object layout:

```text
original/{asset-id}/{content-sha256}.{ext}
variant/{asset-id}/{recipe-version}/{purpose}.{ext}
video/{asset-id}/{recipe-version}/playback.mp4
video/{asset-id}/{recipe-version}/poster.jpg
```

The R2 adapter must support immutable put, stat, ranged get, delete of abandoned
uploads, and local materialization for FFmpeg/image workers. Credentials remain
server-side. The mobile app must not know the bucket name or persist expiring
signed URLs.

## Migration sequence

1. Add an R2 adapter behind the storage port and dual-write new immutable
   objects to local + R2. Compare size and SHA-256 before marking the replica.
2. Backfill historical originals and derivatives with an idempotent manifest:
   storage key, bytes, checksum, content type, copied-at, verified-at.
3. Shadow-read R2 in the audit worker while users still read local objects.
4. Switch Proxy delivery routes to R2/CDN reads, retaining local fallback during
   the observation window. Do not change post rows or client URLs.
5. After backup verification and rollback rehearsal, disable local writes. Keep
   originals under an R2 retention/lifecycle policy; derivatives are rebuildable.

## Release checks

- API and worker log the same absolute local root or the same R2 bucket/prefix.
- A 10-second uploaded video returns `206` for a byte-range request.
- `HEAD`, `ETag`, and `If-None-Match` work for play, thumb, and variant routes.
- Restarting API/worker does not alter post count, order, media IDs, or object
  checksums.
- Missing object, R2 timeout, and expired edge cache each degrade one media item,
  not the entire feed.
- Backup restore can reconstruct the mapping from media asset/variant records to
  every immutable object.
