import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("the D1 schema and report queries execute on SQLite", () => {
  const database = new DatabaseSync(":memory:");
  const migration = readFileSync(
    new URL("../migrations/0001_initial.sql", import.meta.url),
    "utf8",
  );
  const report = readFileSync(
    new URL("../queries/report.sql", import.meta.url),
    "utf8",
  );
  database.exec(migration);
  database.exec(report);
  const table = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'analytics_events'",
  ).get();
  assert.equal(table.name, "analytics_events");
  const insert = database.prepare(
    `INSERT OR IGNORE INTO analytics_events
     (event_id, occurred_at, received_at, installation_id, session_id, app_version,
      schema_version, ui_language, environment, event_name, properties_json)
     VALUES (?, ?, unixepoch(), ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const values = [
    "11111111-1111-4111-8111-111111111111", new Date().toISOString(),
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333", "0.1.8", 1, "ja", "test",
    "analytics_enabled", JSON.stringify({ install_evidence: "unknown" }),
  ];
  insert.run(...values);
  insert.run(...values);
  const count = database.prepare("SELECT COUNT(*) AS count FROM analytics_events").get();
  assert.equal(count.count, 1);
  database.close();
});
