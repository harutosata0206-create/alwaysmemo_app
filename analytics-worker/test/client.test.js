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

let freshModuleId = 0;

async function loadFreshAnalytics() {
  freshModuleId += 1;
  return import(`../../src/lib/analytics.ts?test=${freshModuleId}`);
}

function setupModule(analytics, storage, endpoint = "") {
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
  analytics.initializeAnalytics({
    storage,
    endpoint,
    appVersion: "0.1.8",
    language: "ja",
    environment: "test",
  });
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
  deferAnalytics(storage);
  storage.setItem("alwaysmemo-state", "memo-and-settings");

  resetAnalyticsForDevelopment(storage);

  assert.equal(storage.getItem("alwaysmemo-state"), "memo-and-settings");
  assert.equal(storage.getItem("alwaysmemo-analytics-consent"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-installation"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-session"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-prompt"), null);
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

test("an event after thirty minutes starts a new recorded session", async (context) => {
  const analytics = await loadFreshAnalytics();
  const storage = new MemoryStorage();
  const originalNow = Date.now;
  let now = Date.parse("2026-09-16T00:00:00.000Z");
  Date.now = () => now;
  context.after(() => { Date.now = originalNow; });
  setupModule(analytics, storage);
  analytics.enableAnalytics();
  const firstSession = JSON.parse(storage.getItem("alwaysmemo-analytics-session")).id;

  now += 30 * 60 * 1000 + 1;
  analytics.trackAnalytics({
    name: "file_operation",
    properties: { operation: "save", outcome: "success" },
  });

  const queue = JSON.parse(storage.getItem("alwaysmemo-analytics-queue"));
  assert.deepEqual(queue.slice(-2).map((item) => item.event.name), [
    "session_started",
    "file_operation",
  ]);
  assert.notEqual(queue.at(-1).event.session_id, firstSession);
  assert.equal(queue.at(-2).event.session_id, queue.at(-1).event.session_id);
});

test("a successful batch schedules the remaining queued events", async () => {
  const analytics = await loadFreshAnalytics();
  const storage = new MemoryStorage();
  const scheduled = [];
  const batchSizes = [];
  setupModule(analytics, storage, "https://worker.example/v1/events");
  globalThis.window.setTimeout = (callback, delay) => {
    if (delay !== 5_000) scheduled.push(callback);
    return scheduled.length + 1;
  };
  globalThis.fetch = async (_url, init) => {
    batchSizes.push(JSON.parse(init.body).events.length);
    return new Response(null, { status: 202 });
  };
  analytics.enableAnalytics();
  for (let index = 0; index < 23; index += 1) {
    analytics.trackAnalytics({
      name: "file_operation",
      properties: { operation: "save", outcome: "success" },
    });
  }

  for (let attempt = 0; attempt < 10 && (scheduled.length > 0 || batchSizes.length < 2); attempt += 1) {
    scheduled.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.deepEqual(batchSizes, [20, 5]);
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
});

test("disabling during a request aborts it and keeps local analytics data deleted", async () => {
  const analytics = await loadFreshAnalytics();
  const storage = new MemoryStorage();
  let requestSignal;
  let resolveRequest;
  setupModule(analytics, storage, "https://worker.example/v1/events");
  globalThis.fetch = async (_url, init) => {
    requestSignal = init.signal;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  analytics.enableAnalytics();
  const flushing = analytics.flushAnalytics();
  await new Promise((resolve) => setImmediate(resolve));

  analytics.disableAnalytics(storage);
  const wasAborted = requestSignal.aborted;
  resolveRequest(new Response(null, { status: 202 }));
  await flushing;

  assert.equal(wasAborted, true);
  assert.equal(storage.getItem("alwaysmemo-analytics-installation"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-session"), null);
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
});

test("disabling cancels an offline retry and online events cannot restart it", async (t) => {
  const fixedNow = Date.UTC(2026, 8, 18);
  t.mock.method(Date, "now", () => fixedNow);
  const analytics = await loadFreshAnalytics();
  const storage = new MemoryStorage();
  const timers = new Map();
  const listeners = new Map();
  let timerId = 0;
  globalThis.window = {
    localStorage: storage,
    setTimeout: (callback, delay) => {
      timerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout: (id) => { timers.delete(id); },
    addEventListener: (name, callback) => { listeners.set(name, callback); },
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: () => {},
  };
  analytics.initializeAnalytics({
    storage,
    endpoint: "https://worker.example/v1/events",
    appVersion: "0.1.8",
    language: "ja",
    environment: "test",
  });
  globalThis.fetch = async () => { throw new Error("offline"); };
  analytics.enableAnalytics();
  await analytics.flushAnalytics();
  const queued = JSON.parse(storage.getItem("alwaysmemo-analytics-queue"));
  assert.equal(queued.length, 2);
  assert.ok(queued.every((item) =>
    item.attempts === 1 &&
    item.nextAttemptAt === fixedNow + 60_000,
  ));
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 60_000);

  analytics.disableAnalytics(storage);
  listeners.get("online")();

  assert.equal(timers.size, 0);
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
});

test("coming back online immediately sends the retained queue through the Worker", async () => {
  const analytics = await loadFreshAnalytics();
  const storage = new MemoryStorage();
  const timers = new Map();
  const listeners = new Map();
  let timerId = 0;
  let online = false;
  const bound = [];
  globalThis.window = {
    localStorage: storage,
    setTimeout: (callback, delay) => {
      timerId += 1;
      timers.set(timerId, { callback, delay });
      return timerId;
    },
    clearTimeout: (id) => { timers.delete(id); },
    addEventListener: (name, callback) => { listeners.set(name, callback); },
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: () => {},
  };
  analytics.initializeAnalytics({
    storage,
    endpoint: "https://worker.example/v1/events",
    appVersion: "0.1.8",
    language: "ja",
    environment: "test",
  });
  globalThis.fetch = async (url, init) => {
    if (!online) throw new Error("offline");
    return worker.fetch(new Request(url, {
      ...init,
      headers: { ...init.headers, Origin: "http://tauri.localhost" },
    }), {
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
    });
  };
  analytics.enableAnalytics();
  await analytics.flushAnalytics();
  assert.equal(JSON.parse(storage.getItem("alwaysmemo-analytics-queue")).length, 2);

  online = true;
  listeners.get("online")();
  const immediateTimer = [...timers.entries()].find(([, timer]) => timer.delay === 0);
  assert.ok(immediateTimer);
  timers.delete(immediateTimer[0]);
  immediateTimer[1].callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(bound.length, 2);
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
});

test("separate windows share one installation, session, consent, and queue", async () => {
  const firstWindow = await loadFreshAnalytics();
  const secondWindow = await loadFreshAnalytics();
  const storage = new MemoryStorage();
  setupModule(firstWindow, storage);
  firstWindow.enableAnalytics();
  setupModule(secondWindow, storage);

  firstWindow.trackAnalytics({
    name: "file_operation",
    properties: { operation: "save", outcome: "success" },
  });
  secondWindow.trackAnalytics({
    name: "core_action_succeeded",
    properties: { action: "focus", context: "normal", trigger: "global_shortcut" },
  });

  const queue = JSON.parse(storage.getItem("alwaysmemo-analytics-queue"));
  assert.equal(new Set(queue.map((item) => item.event.installation_id)).size, 1);
  assert.equal(new Set(queue.map((item) => item.event.session_id)).size, 1);
  assert.deepEqual(queue.slice(-2).map((item) => item.event.name), [
    "file_operation",
    "core_action_succeeded",
  ]);

  firstWindow.disableAnalytics(storage);
  secondWindow.trackAnalytics({
    name: "file_operation",
    properties: { operation: "open", outcome: "success" },
  });
  assert.equal(storage.getItem("alwaysmemo-analytics-consent"), "disabled");
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
});

test("disabling in one window aborts an active request in another window", async () => {
  const firstWindowAnalytics = await loadFreshAnalytics();
  const secondWindowAnalytics = await loadFreshAnalytics();
  const storage = new MemoryStorage();
  const firstListeners = new Map();
  const secondListeners = new Map();
  const createWindow = (listeners) => ({
    localStorage: storage,
    setTimeout: () => 1,
    clearTimeout: () => {},
    addEventListener: (name, callback) => { listeners.set(name, callback); },
  });
  const firstWindow = createWindow(firstListeners);
  const secondWindow = createWindow(secondListeners);
  globalThis.document = {
    visibilityState: "visible",
    addEventListener: () => {},
  };
  globalThis.window = firstWindow;
  firstWindowAnalytics.initializeAnalytics({
    storage,
    endpoint: "https://worker.example/v1/events",
    appVersion: "0.1.8",
    language: "ja",
    environment: "test",
  });
  firstWindowAnalytics.enableAnalytics();
  globalThis.window = secondWindow;
  secondWindowAnalytics.initializeAnalytics({
    storage,
    endpoint: "https://worker.example/v1/events",
    appVersion: "0.1.8",
    language: "ja",
    environment: "test",
  });
  let requestSignal;
  let resolveRequest;
  globalThis.fetch = async (_url, init) => {
    requestSignal = init.signal;
    return new Promise((resolve) => { resolveRequest = resolve; });
  };
  const flushing = secondWindowAnalytics.flushAnalytics();
  await new Promise((resolve) => setImmediate(resolve));

  globalThis.window = firstWindow;
  firstWindowAnalytics.disableAnalytics(storage);
  globalThis.window = secondWindow;
  assert.equal(typeof secondListeners.get("storage"), "function");
  secondListeners.get("storage")({
    key: "alwaysmemo-analytics-consent",
    newValue: "disabled",
  });
  const wasAborted = requestSignal.aborted;
  resolveRequest(new Response(null, { status: 202 }));
  await flushing;

  assert.equal(wasAborted, true);
  assert.equal(storage.getItem("alwaysmemo-analytics-queue"), null);
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
