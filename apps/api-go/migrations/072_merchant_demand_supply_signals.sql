CREATE TABLE IF NOT EXISTS business.aggregated_demand_signals (
  id BIGSERIAL PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business.accounts(id),
  total_matching_demand INTEGER NOT NULL CHECK (total_matching_demand >= 0),
  confirmed_arrivals INTEGER NOT NULL CHECK (confirmed_arrivals >= 0),
  high_probability_arrivals INTEGER NOT NULL CHECK (high_probability_arrivals >= 0),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence > 0 AND confidence <= 1),
  recorded_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS business_demand_latest_idx ON business.aggregated_demand_signals(business_id, recorded_at DESC);
CREATE TABLE IF NOT EXISTS business.scene_supply_snapshots (
  id BIGSERIAL PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business.accounts(id),
  store_id TEXT NOT NULL REFERENCES business.stores(id), scene_id TEXT NOT NULL,
  current_capacity_pct INTEGER NOT NULL CHECK (current_capacity_pct BETWEEN 0 AND 100),
  forecast_capacity_pct INTEGER NOT NULL CHECK (forecast_capacity_pct BETWEEN 0 AND 100),
  accepting_traffic BOOLEAN NOT NULL, confidence DOUBLE PRECISION NOT NULL CHECK (confidence > 0 AND confidence <= 1),
  recorded_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS business_supply_latest_idx ON business.scene_supply_snapshots(business_id, recorded_at DESC);
