import assert from "node:assert/strict";
import test from "node:test";
import worker, { validateBatch } from "../src/index.js";

const event = {
  schema_version: 1,
  event_id: "11111111-1111-4111-8111-111111111111",
  occurred_at: new Date().toISOString(),
  installation_id: "22222222-2222-4222-8222-222222222222",
  session_id: "33333333-3333-4333-8333-333333333333",
  app_version: "0.1.8",
  ui_language: "ja",
  environment: "test",
  name: "file_operation",
  properties: { operation: "save", outcome: "success" },
};

test("accepts an allowlisted event", () => {
  assert.deepEqual(validateBatch({ events: [event] }), { ok: true });
});

test("rejects memo text or file paths", () => {
  const withMemo = { ...event, properties: { ...event.properties, memo_text: "secret" } };
  const withPath = { ...event, properties: { ...event.properties, file_path: "C:\\secret.txt" } };
  assert.equal(validateBatch({ events: [withMemo] }).ok, false);
  assert.equal(validateBatch({ events: [withPath] }).ok, false);
});

test("rejects unknown events and oversized batches", () => {
  assert.equal(validateBatch({ events: [{ ...event, name: "anything" }] }).ok, false);
  assert.equal(validateBatch({ events: [{ ...event, name: "__proto__" }] }).ok, false);
  assert.equal(validateBatch({ events: Array(21).fill(event) }).ok, false);
});

test("the Worker accepts a validated batch and binds it to D1", async () => {
  const bound = [];
  const DB = {
    prepare: () => ({
      bind: (...values) => {
        bound.push(values);
        return { values };
      },
    }),
    batch: async (statements) => statements,
  };
  const request = new Request("https://worker.example/v1/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "http://tauri.localhost" },
    body: JSON.stringify({ events: [event] }),
  });
  const response = await worker.fetch(request, {
    DB,
    ALLOWED_ORIGINS: "http://tauri.localhost",
  });
  assert.equal(response.status, 202);
  assert.equal(bound.length, 1);
  assert.equal(bound[0][0], event.event_id);
});
