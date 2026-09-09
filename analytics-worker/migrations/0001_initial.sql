CREATE TABLE analytics_events (
  event_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  installation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  app_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  ui_language TEXT NOT NULL,
  environment TEXT NOT NULL,
  event_name TEXT NOT NULL,
  properties_json TEXT NOT NULL CHECK (json_valid(properties_json))
);

CREATE INDEX idx_analytics_events_time
  ON analytics_events(received_at);
CREATE INDEX idx_analytics_events_installation_time
  ON analytics_events(installation_id, occurred_at);
CREATE INDEX idx_analytics_events_name_time
  ON analytics_events(event_name, occurred_at);
