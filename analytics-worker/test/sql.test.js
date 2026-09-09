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
  database.close();
});
