import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function insertEvent(database, {
  eventId,
  occurredAt,
  installationId,
  sessionId,
  eventName,
  properties,
  environment = "production",
}) {
  database.prepare(
    `INSERT INTO analytics_events
     (event_id, occurred_at, received_at, installation_id, session_id, app_version,
      schema_version, ui_language, environment, event_name, properties_json)
     VALUES (?, ?, unixepoch(), ?, ?, '0.1.8', 1, 'ja', ?, ?, ?)`,
  ).run(
    eventId,
    occurredAt,
    installationId,
    sessionId,
    environment,
    eventName,
    JSON.stringify(properties),
  );
}

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

test("the first-day reach query compares ISO timestamps as dates", () => {
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
  const optedAt = new Date();
  optedAt.setUTCDate(optedAt.getUTCDate() - 10);
  optedAt.setUTCHours(20, 0, 0, 0);
  const editedAt = new Date(optedAt.getTime() + 13 * 60 * 60 * 1000);
  const installationId = "22222222-2222-4222-8222-222222222222";
  const sessionId = "33333333-3333-4333-8333-333333333333";
  insertEvent(database, {
    eventId: "11111111-1111-4111-8111-111111111111",
    occurredAt: optedAt.toISOString(),
    installationId,
    sessionId,
    eventName: "analytics_enabled",
    properties: { install_evidence: "unknown" },
  });
  insertEvent(database, {
    eventId: "44444444-4444-4444-8444-444444444444",
    occurredAt: editedAt.toISOString(),
    installationId,
    sessionId,
    eventName: "memo_first_edited",
    properties: { became_non_empty: true },
  });
  const reachQuery = report.split(";")[1];

  const result = database.prepare(reachQuery).get();

  assert.equal(result.opted_in, 1);
  assert.equal(result.edited, 1);
  assert.equal(result.edit_reach_pct, 100);
  database.close();
});

test("the first-day reach excludes incomplete 24-hour cohorts", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(readFileSync(new URL("../migrations/0001_initial.sql", import.meta.url), "utf8"));
  const report = readFileSync(new URL("../queries/report.sql", import.meta.url), "utf8");
  const now = Date.now();
  const sessionId = "33333333-3333-4333-8333-333333333333";
  insertEvent(database, {
    eventId: "55555555-5555-4555-8555-555555555555",
    occurredAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    installationId: "66666666-6666-4666-8666-666666666666",
    sessionId,
    eventName: "analytics_enabled",
    properties: { install_evidence: "unknown" },
  });
  insertEvent(database, {
    eventId: "77777777-7777-4777-8777-777777777777",
    occurredAt: new Date(now - 60 * 60 * 1000).toISOString(),
    installationId: "88888888-8888-4888-8888-888888888888",
    sessionId,
    eventName: "analytics_enabled",
    properties: { install_evidence: "unknown" },
  });
  insertEvent(database, {
    eventId: "99999999-9999-4999-8999-999999999999",
    occurredAt: new Date(now - 30 * 60 * 1000).toISOString(),
    installationId: "88888888-8888-4888-8888-888888888888",
    sessionId,
    eventName: "memo_first_edited",
    properties: { became_non_empty: true },
  });
  insertEvent(database, {
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    occurredAt: new Date(now - 20 * 60 * 1000).toISOString(),
    installationId: "88888888-8888-4888-8888-888888888888",
    sessionId,
    eventName: "core_action_succeeded",
    properties: { action: "always_on_top", context: "normal", trigger: "menu" },
  });

  const reachQuery = report.split(";")[1];
  const result = database.prepare(reachQuery).get();

  assert.equal(result.opted_in, 1);
  assert.equal(result.edited, 0);
  assert.equal(result.edit_reach_pct, 0);
  assert.equal(result.used_core, 0);
  assert.equal(result.core_reach_pct, 0);
  database.prepare("DELETE FROM analytics_events WHERE installation_id = ?")
    .run("66666666-6666-4666-8666-666666666666");
  const incompleteOnly = database.prepare(reachQuery).get();
  assert.equal(incompleteOnly.opted_in, 0);
  assert.equal(incompleteOnly.edit_reach_pct, null);
  assert.equal(incompleteOnly.core_reach_pct, null);
  database.close();
});
