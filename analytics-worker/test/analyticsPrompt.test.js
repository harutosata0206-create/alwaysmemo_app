import assert from "node:assert/strict";
import test from "node:test";
import {
  recordAnalyticsPromptDeferral,
  shouldShowDeferredAnalyticsPrompt,
} from "../../src/lib/analyticsPrompt.ts";
import {
  deferAnalytics,
  shouldShowAnalyticsPrompt,
} from "../../src/lib/analytics.ts";

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key) { return this.values.get(key) ?? null; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  removeItem(key) { this.values.delete(key); }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const start = new Date(2026, 0, 1, 12).getTime();

test("the consent state uses the reminder schedule after Later", () => {
  const storage = new MemoryStorage();
  assert.equal(shouldShowAnalyticsPrompt(storage, start), true);

  deferAnalytics(storage, start);
  assert.equal(shouldShowAnalyticsPrompt(storage, start + DAY_MS), false);
  assert.equal(shouldShowAnalyticsPrompt(storage, start + 2 * DAY_MS), false);
  assert.equal(shouldShowAnalyticsPrompt(storage, start + 7 * DAY_MS), true);
});

test("first reminder requires seven days and three distinct usage days", () => {
  const storage = new MemoryStorage();
  recordAnalyticsPromptDeferral(storage, start);

  assert.equal(shouldShowDeferredAnalyticsPrompt(storage, start + DAY_MS), false);
  assert.equal(shouldShowDeferredAnalyticsPrompt(storage, start + 2 * DAY_MS), false);
  assert.equal(shouldShowDeferredAnalyticsPrompt(storage, start + 7 * DAY_MS), true);
});

test("second reminder waits thirty days after the second deferral", () => {
  const storage = new MemoryStorage();
  recordAnalyticsPromptDeferral(storage, start);
  shouldShowDeferredAnalyticsPrompt(storage, start + DAY_MS);
  shouldShowDeferredAnalyticsPrompt(storage, start + 7 * DAY_MS);
  recordAnalyticsPromptDeferral(storage, start + 7 * DAY_MS);

  assert.equal(shouldShowDeferredAnalyticsPrompt(storage, start + 36 * DAY_MS), false);
  assert.equal(shouldShowDeferredAnalyticsPrompt(storage, start + 37 * DAY_MS), true);
});

test("third deferral permanently stops automatic reminders", () => {
  const storage = new MemoryStorage();
  recordAnalyticsPromptDeferral(storage, start);
  recordAnalyticsPromptDeferral(storage, start + 7 * DAY_MS);
  recordAnalyticsPromptDeferral(storage, start + 37 * DAY_MS);

  assert.equal(shouldShowDeferredAnalyticsPrompt(storage, start + 365 * DAY_MS), false);
});

test("legacy deferred users start a new seven-day wait", () => {
  const storage = new MemoryStorage();

  assert.equal(shouldShowDeferredAnalyticsPrompt(storage, start), false);
  assert.equal(shouldShowDeferredAnalyticsPrompt(storage, start + 7 * DAY_MS), false);
});
