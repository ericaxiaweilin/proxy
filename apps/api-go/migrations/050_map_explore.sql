-- 050_map_explore.sql — lat/lng for map exploration (R15.32)
--
-- Why: MapExploreSurface in the mobile app needs to plot posts / agents /
-- orders on a real Apple Map. Until now everything was city-scoped
-- (city_scope text like 'hn' / 'hcm' / 'dn'); there was no point-level
-- data to put on a map.
--
-- Strategy:
--   1. Add nullable lat/lng (double precision) to localnet.posts and
--      supply.agent_profiles. Nullable so we can roll this out before
--      a backfill completes; the backfill is in (2).
--   2. Backfill existing rows from city_scope. We use the city center
--      from `data.city_centers` (NEW) + a deterministic per-row jitter
--      derived from the row id. Deterministic so the result is stable
--      across re-runs and reviewers see the same dots.
--   3. Add a btree index on (lat, lng) for both tables so bbox
--      queries (WHERE lat BETWEEN $1 AND $2 AND lng BETWEEN $3 AND $4)
--      don't have to seq-scan.
--
-- Constraints:
--   - lat ∈ [-90, 90], lng ∈ [-180, 180] (CHECK NOT VALID, like 049).
--   - This migration does NOT touch fulfillment.orders. The fulfillment
--     team can adopt the same pattern when they wire their model.

-- ----------------------------------------------------------------------------
-- 1. Schema: lat/lng columns + CHECK + index
-- ----------------------------------------------------------------------------

ALTER TABLE localnet.posts
    ADD COLUMN IF NOT EXISTS lat double precision,
    ADD COLUMN IF NOT EXISTS lng double precision;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_lat_range') THEN
        ALTER TABLE localnet.posts
            ADD CONSTRAINT posts_lat_range
            CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_lng_range') THEN
        ALTER TABLE localnet.posts
            ADD CONSTRAINT posts_lng_range
            CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)) NOT VALID;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_posts_map_latlng
    ON localnet.posts (lat, lng)
    WHERE lat IS NOT NULL AND lng IS NOT NULL;

ALTER TABLE supply.agent_profiles
    ADD COLUMN IF NOT EXISTS lat double precision,
    ADD COLUMN IF NOT EXISTS lng double precision;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_profiles_lat_range') THEN
        ALTER TABLE supply.agent_profiles
            ADD CONSTRAINT agent_profiles_lat_range
            CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_profiles_lng_range') THEN
        ALTER TABLE supply.agent_profiles
            ADD CONSTRAINT agent_profiles_lng_range
            CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)) NOT VALID;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_agent_profiles_map_latlng
    ON supply.agent_profiles (lat, lng)
    WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. fulfillment.orders — same lat/lng treatment, but backfilled from
--    the embedded snapshot->>'city' (jsonb) since orders don't have a
--    separate city_scope column.
-- ----------------------------------------------------------------------------

ALTER TABLE fulfillment.orders
    ADD COLUMN IF NOT EXISTS lat double precision,
    ADD COLUMN IF NOT EXISTS lng double precision;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_lat_range') THEN
        ALTER TABLE fulfillment.orders
            ADD CONSTRAINT orders_lat_range
            CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_lng_range') THEN
        ALTER TABLE fulfillment.orders
            ADD CONSTRAINT orders_lng_range
            CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)) NOT VALID;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_orders_map_latlng
    ON fulfillment.orders (lat, lng)
    WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. City center reference (single source of truth)
-- ----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS data;

CREATE TABLE IF NOT EXISTS data.city_centers (
    city_id text PRIMARY KEY,
    name_zh text NOT NULL,
    country_code text NOT NULL DEFAULT 'VN',
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    -- approximate radius (km) for jitter — bigger cities spread pins further
    radius_km double precision NOT NULL DEFAULT 8
);

INSERT INTO data.city_centers (city_id, name_zh, lat, lng, radius_km) VALUES
    ('hn',  '河内',     21.0285, 105.8542, 10),
    ('hcm', '胡志明市', 10.7760, 106.7010, 12),
    ('dn',  '岘港',     16.0540, 108.2020, 8),
    ('hp',  '海防',     20.8449, 106.6881, 7),
    ('ct',  '芹苴',     10.0452, 105.7469, 6),
    ('nt',  '顺化',     16.4637, 107.5908, 6),
    ('bd',  '边和',     10.9804, 106.6519, 5)
ON CONFLICT (city_id) DO UPDATE
    SET name_zh = EXCLUDED.name_zh,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        radius_km = EXCLUDED.radius_km;

-- ----------------------------------------------------------------------------
-- 3. Backfill: deterministic per-row jitter
-- ----------------------------------------------------------------------------
--
-- We need a hash of the id to a unit vector in [-1, 1]², scale by
-- radius_km / 111.0 (1° lat ~ 111 km). pg's built-in hashtext() is
-- stable within a major version, so the seed dots stay put until
-- someone intentionally re-jitters (e.g. via UPDATE).
--
-- Format: a procedural DO block that iterates each row. For large
-- tables this would be a one-shot plpgsql loop; for our scale (a few
-- hundred demo rows) it is fast enough.

DO $$
DECLARE
    r   record;
    c   record;
    -- hash-derived offset in [-0.5, 0.5] for x and y
    hx  double precision;
    hy  double precision;
    km_per_deg double precision := 111.0;
    j_lat double precision;
    j_lng double precision;
    base_lat double precision;
    base_lng double precision;
    radius double precision;
BEGIN
    FOR r IN
        SELECT id, city_scope
        FROM localnet.posts
        WHERE lat IS NULL AND lng IS NULL AND city_scope IS NOT NULL
    LOOP
        SELECT cc.lat, cc.lng, cc.radius_km
        INTO base_lat, base_lng, radius
        FROM data.city_centers cc
        WHERE cc.city_id = r.city_scope;

        IF base_lat IS NULL THEN
            -- Fallback: Hanoi center
            base_lat := 21.0285; base_lng := 105.8542; radius := 8;
        END IF;

        -- Deterministic hash → two unit offsets
        -- hashtext returns int4; abs % 10000 / 10000.0 → [0, 1)
        hx := (abs(hashtext(r.id || ':x')) % 10000) / 10000.0 - 0.5;  -- [-0.5, 0.5)
        hy := (abs(hashtext(r.id || ':y')) % 10000) / 10000.0 - 0.5;

        -- Convert km offset to degree offset. Lng offset shrinks with
        -- latitude (cos(lat) factor).
        j_lat := (hy * 2.0 * radius) / km_per_deg;
        j_lng := (hx * 2.0 * radius) / (km_per_deg * cos(radians(base_lat)));

        UPDATE localnet.posts
        SET lat = base_lat + j_lat,
            lng = base_lng + j_lng
        WHERE id = r.id;
    END LOOP;

    FOR r IN
        SELECT agent_id, service_areas
        FROM supply.agent_profiles
        WHERE lat IS NULL AND lng IS NULL
    LOOP
        -- Take the first market in service_areas, or fall back to hcm.
        SELECT cc.lat, cc.lng, cc.radius_km
        INTO base_lat, base_lng, radius
        FROM data.city_centers cc
        WHERE cc.city_id = COALESCE(r.service_areas ->> 0, 'hcm');

        IF base_lat IS NULL THEN
            base_lat := 10.7760; base_lng := 106.7010; radius := 8;
        END IF;

        hx := (abs(hashtext(r.agent_id || ':x')) % 10000) / 10000.0 - 0.5;
        hy := (abs(hashtext(r.agent_id || ':y')) % 10000) / 10000.0 - 0.5;

        j_lat := (hy * 2.0 * radius) / km_per_deg;
        j_lng := (hx * 2.0 * radius) / (km_per_deg * cos(radians(base_lat)));

        UPDATE supply.agent_profiles
        SET lat = base_lat + j_lat,
            lng = base_lng + j_lng
        WHERE agent_id = r.agent_id;
    END LOOP;

    -- Orders: city comes from snapshot->>'city'. Fall back to hcm if missing.
    FOR r IN
        SELECT id, snapshot->>'city' AS city, snapshot->>'title' AS title
        FROM fulfillment.orders
        WHERE lat IS NULL AND lng IS NULL
    LOOP
        SELECT cc.lat, cc.lng, cc.radius_km
        INTO base_lat, base_lng, radius
        FROM data.city_centers cc
        WHERE cc.city_id = COALESCE(r.city, 'hcm');

        IF base_lat IS NULL THEN
            base_lat := 10.7760; base_lng := 106.7010; radius := 8;
        END IF;

        hx := (abs(hashtext(r.id || ':x')) % 10000) / 10000.0 - 0.5;
        hy := (abs(hashtext(r.id || ':y')) % 10000) / 10000.0 - 0.5;

        j_lat := (hy * 2.0 * radius) / km_per_deg;
        j_lng := (hx * 2.0 * radius) / (km_per_deg * cos(radians(base_lat)));

        UPDATE fulfillment.orders
        SET lat = base_lat + j_lat,
            lng = base_lng + j_lng
        WHERE id = r.id;
    END LOOP;
END$$;
