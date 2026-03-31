CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upstreams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  upstream_group TEXT NOT NULL DEFAULT 'default',
  api_base_url TEXT NOT NULL,
  models_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  upstream_id TEXT NOT NULL,
  id TEXT NOT NULL,
  created INTEGER,
  owned_by TEXT,
  display_name TEXT,
  icon TEXT,
  is_visible INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (upstream_id, id),
  FOREIGN KEY (upstream_id) REFERENCES upstreams(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS probes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upstream_id TEXT NOT NULL,
  upstream_name TEXT NOT NULL,
  model TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  success INTEGER NOT NULL,
  status_code INTEGER,
  error TEXT,
  connectivity_latency_ms INTEGER,
  first_token_latency_ms INTEGER,
  total_latency_ms INTEGER NOT NULL,
  raw_response_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_upstreams_active ON upstreams(is_active);
CREATE INDEX IF NOT EXISTS idx_models_active ON models(is_active);
CREATE INDEX IF NOT EXISTS idx_models_visibility ON models(is_visible);
CREATE INDEX IF NOT EXISTS idx_probes_started_at ON probes(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_probes_model_started_at ON probes(upstream_id, model, started_at DESC);
