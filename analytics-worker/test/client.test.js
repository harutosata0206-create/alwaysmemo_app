import assert from "node:assert/strict";
import test from "node:test";
import {
  deferAnalytics,
  disableAnalytics,
  enableAnalytics,
  flushAnalytics,
  initializeAnalytics,
  resetAnalyticsForDevelopment,
  trackAnalytics,
} from "../../src/lib/analytics.ts";
import worker from "../src/index.js";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
  key(index) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

function setup(storage, endpoint = "") {
  globalThis.window = {
    localStorage: storage,
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener: () => {},
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: () => {},
  };
  initializeAnalytics({
    storage,
    endpoint,
    appVersion: "0.1.8",
    language: "ja",
    environment: "test",
  });
}

test("does not queue events before consent or after Later", () => {
  const storage = new MemoryStorage();
  setup(storage);
  trackAnalytics({ name: "memo_first_edited", properties: { became_non_empty: true } });
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
  deferAnalytics(storage);
  trackAnalytics({ name: "memo_first_edited", properties: { became_non_empty: true } });
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
});

test("enabling creates anonymous events without memo or path data", () => {
  const storage = new MemoryStorage();
  storage.setItem("alwaysmemo-state", "{}");
  setup(storage);
  enableAnalytics();
  trackAnalytics({ name: "file_operation", properties: { operation: "save", outcome: "success" } });
  const queue = JSON.parse(storage.getItem("alwaysmemo-analytics-queue"));
  assert.equal(queue.length, 3);
  assert.equal(queue[0].event.properties.install_evidence, "preexisting");
  const serialized = JSON.stringify(queue);
  assert.equal(serialized.includes("memo_text"), false);
  assert.equal(serialized.includes("file_path"), false);
});

test("disabling purges the anonymous id, session, and unsent queue", () => {
  const storage = new MemoryStorage();
  setup(storage);
  enableAnalytics();
  disableAnalytics(storage);
  assert.equal(storage.getItem("alwaysmemo-analytics-installation"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-session"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
});

test("development analytics reset preserves memo and settings state", () => {
  const storage = new MemoryStorage();
  setup(storage);
  enableAnalytics();
  storage.setItem("alwaysmemo-state", "memo-and-settings");

  resetAnalyticsForDevelopment(storage);

  assert.equal(storage.getItem("alwaysmemo-state"), "memo-and-settings");
  assert.equal(storage.getItem("alwaysmemo-analytics-consent"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-installation"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-session"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
});

test("the local queue stays within 500 events", () => {
  const storage = new MemoryStorage();
  setup(storage);
  enableAnalytics();
  for (let index = 0; index < 510; index += 1) {
    trackAnalytics({ name: "memo_first_edited", properties: { became_non_empty: index % 2 === 0 } });
  }
  const queue = JSON.parse(storage.getItem("alwaysmemo-analytics-queue"));
  assert.ok(queue.length <= 500);
});

test("reinitializing another window shares the same session", () => {
  const storage = new MemoryStorage();
  setup(storage);
  enableAnalytics();
  const before = JSON.parse(storage.getItem("alwaysmemo-analytics-queue"));
  setup(storage);
  const after = JSON.parse(storage.getItem("alwaysmemo-analytics-queue"));
  assert.equal(after.length, before.length);
  assert.equal(after[0].event.session_id, after[1].event.session_id);
});

test("a network failure keeps the event with a limited retry count", async () => {
  const storage = new MemoryStorage();
  setup(storage, "https://example.invalid/v1/events");
  globalThis.fetch = async () => { throw new Error("offline"); };
  enableAnalytics();
  await flushAnalytics();
  const queue = JSON.parse(storage.getItem("alwaysmemo-analytics-queue"));
  assert.equal(queue.length, 2);
  assert.equal(queue[0].attempts, 1);
});

test("a timed out request keeps the event for retry", async () => {
  const storage = new MemoryStorage();
  setup(storage, "https://example.invalid/v1/events");
  enableAnalytics();
  globalThis.window.setTimeout = (callback) => {
    queueMicrotask(callback);
    return 1;
  };
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new Error("timeout")));
  });
  await flushAnalytics();
  const queue = JSON.parse(storage.getItem("alwaysmemo-analytics-queue"));
  assert.equal(queue.length, 2);
  assert.equal(queue[0].attempts, 1);
});

test("events are discarded after the bounded retry schedule", async () => {
  const storage = new MemoryStorage();
  setup(storage, "https://example.invalid/v1/events");
  globalThis.fetch = async () => { throw new Error("offline"); };
  enableAnalytics();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await flushAnalytics();
    const queue = JSON.parse(storage.getItem("alwaysmemo-analytics-queue") ?? "[]");
    for (const item of queue) item.nextAttemptAt = 0;
    if (queue.length > 0) {
      storage.setItem("alwaysmemo-analytics-queue", JSON.stringify(queue));
    }
  }
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
});

test("client events pass through the Worker receiver and leave the queue", async () => {
  const storage = new MemoryStorage();
  const bound = [];
  const env = {
    ALLOWED_ORIGINS: "http://tauri.localhost",
    EVENTS_RATE_LIMITER: { limit: async () => ({ success: true }) },
    DB: {
      prepare: () => ({
        bind: (...values) => {
          bound.push(values);
          return { values };
        },
      }),
      batch: async (statements) => statements,
    },
  };
  setup(storage, "https://worker.example/v1/events");
  globalThis.fetch = (url, init) =>
    worker.fetch(new Request(url, {
      ...init,
      headers: { ...init.headers, Origin: "http://tauri.localhost" },
    }), env);
  enableAnalytics();
  await flushAnalytics();
  assert.equal(bound.length, 2);
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
});
