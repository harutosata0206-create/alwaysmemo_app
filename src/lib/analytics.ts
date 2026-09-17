import type { AppLanguage } from "./i18n";
import {
  clearAnalyticsPromptState,
  recordAnalyticsPromptDeferral,
  shouldShowDeferredAnalyticsPrompt,
} from "./analyticsPrompt.ts";

export const ANALYTICS_CONSENT_STORAGE_KEY = "alwaysmemo-analytics-consent";
const CONSENT_KEY = ANALYTICS_CONSENT_STORAGE_KEY;
const INSTALLATION_KEY = "alwaysmemo-analytics-installation";
const INSTALL_EVIDENCE_KEY = "alwaysmemo-analytics-install-evidence";
const SESSION_KEY = "alwaysmemo-analytics-session";
const QUEUE_KEY = "alwaysmemo-analytics-queue";
const LEGACY_KEYS = ["alwaysmemo-state", "alwaysmemo-onboarding-completed", "alwaysmemo-review-prompt", "alwaysmemo-default-app-prompt"] as const;
const SCHEMA_VERSION = 1;
const SESSION_IDLE_MS = 30 * 60 * 1000;
const QUEUE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_QUEUE_EVENTS = 500;
const MAX_QUEUE_BYTES = 512 * 1024;
const MAX_BATCH_SIZE = 20;
const REQUEST_TIMEOUT_MS = 5_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 8 * 60 * 60_000];

export type AnalyticsConsent = "enabled" | "deferred" | "disabled" | "unset";
export type AnalyticsContext = "normal" | "onboarding";
export type AnalyticsTrigger = "global_shortcut" | "local_shortcut" | "menu" | "settings";
export type CoreAction =
  | "always_on_top" | "focus" | "snap_left" | "snap_right" | "snap_top"
  | "snap_bottom" | "fit_content" | "minimum_size";
export type FileOperation = "open" | "save" | "save_as" | "save_all";
export type FileOutcome = "success" | "cancelled" | "failure";
export type SafeErrorCategory =
  | "dialog" | "permission" | "not_found" | "read" | "write" | "window" | "unknown";

export type AnalyticsEvent =
  | { name: "analytics_enabled"; properties: { install_evidence: "preexisting" | "unknown" } }
  | { name: "session_started"; properties: { install_evidence: "preexisting" | "unknown" } }
  | { name: "memo_first_edited"; properties: { became_non_empty: boolean } }
  | {
      name: "core_action_succeeded";
      properties: { action: CoreAction; context: AnalyticsContext; trigger: AnalyticsTrigger };
    }
  | {
      name: "onboarding_event";
      properties: {
        action: "shown" | "step_viewed" | "step_succeeded" | "completed" | "skipped";
        step?: "snap" | "alwaysOnTop" | "focus" | "fitContent";
      };
    }
  | {
      name: "prompt_event";
      properties: {
        prompt: "default_app" | "review";
        action: "shown" | "later" | "dismissed" | "opened";
      };
    }
  | {
      name: "file_operation";
      properties: {
        operation: FileOperation;
        outcome: FileOutcome;
        error_category?: SafeErrorCategory;
      };
    };

type StoredEvent = AnalyticsEvent & {
  schema_version: number;
  event_id: string;
  occurred_at: string;
  installation_id: string;
  session_id: string;
  app_version: string;
  ui_language: AppLanguage;
  environment: "production" | "development" | "test";
};
type SessionRecord = { id: string; lastActivityAt: number; onceKeys: string[] };
type QueuedEvent = { event: StoredEvent; attempts: number; nextAttemptAt: number };
type AnalyticsRuntime = {
  storage: Storage;
  endpoint: string;
  appVersion: string;
  language: AppLanguage;
  environment: StoredEvent["environment"];
};

let runtime: AnalyticsRuntime | null = null;
let flushTimer: number | null = null;
let flushTimerDueAt: number | null = null;
let flushPromise: Promise<void> | null = null;
let activeRequest: { controller: AbortController; storage: Storage } | null = null;
let listenersInstalled = false;

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

function getConsent(storage: Storage): AnalyticsConsent {
  const value = storage.getItem(CONSENT_KEY);
  return value === "enabled" || value === "deferred" || value === "disabled" ? value : "unset";
}

export function getAnalyticsConsent(storage: Storage = window.localStorage): AnalyticsConsent {
  try { return getConsent(storage); } catch { return "unset"; }
}

export function shouldShowAnalyticsPrompt(
  storage: Storage = window.localStorage,
  now = Date.now(),
): boolean {
  try {
    const consent = getConsent(storage);
    if (consent === "unset") return true;
    return consent === "deferred" && shouldShowDeferredAnalyticsPrompt(storage, now);
  } catch {
    return false;
  }
}

export function captureAnalyticsInstallEvidence(
  storage: Storage = window.localStorage,
): "preexisting" | "unknown" {
  try {
    const stored = storage.getItem(INSTALL_EVIDENCE_KEY);
    if (stored === "preexisting" || stored === "unknown") return stored;
    const evidence = LEGACY_KEYS.some((key) => storage.getItem(key) !== null) ? "preexisting" : "unknown";
    storage.setItem(INSTALL_EVIDENCE_KEY, evidence);
    return evidence;
  } catch {
    return "unknown";
  }
}

function getInstallEvidence(storage: Storage): "preexisting" | "unknown" {
  return captureAnalyticsInstallEvidence(storage);
}

function getInstallationId(storage: Storage): string {
  const existing = storage.getItem(INSTALLATION_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  storage.setItem(INSTALLATION_KEY, id);
  return id;
}

function readSession(storage: Storage, now: number): SessionRecord {
  const stored = parseJson<Partial<SessionRecord>>(storage.getItem(SESSION_KEY));
  if (typeof stored?.id === "string" && typeof stored.lastActivityAt === "number" && now - stored.lastActivityAt <= SESSION_IDLE_MS) {
    return {
      id: stored.id,
      lastActivityAt: now,
      onceKeys: Array.isArray(stored.onceKeys)
        ? stored.onceKeys.filter((key): key is string => typeof key === "string").slice(-50)
        : [],
    };
  }
  return { id: crypto.randomUUID(), lastActivityAt: now, onceKeys: [] };
}

function readQueue(storage: Storage): QueuedEvent[] {
  const queue = parseJson<QueuedEvent[]>(storage.getItem(QUEUE_KEY));
  const cutoff = Date.now() - QUEUE_RETENTION_MS;
  return Array.isArray(queue)
    ? queue.filter((item) => item?.event?.occurred_at && Date.parse(item.event.occurred_at) >= cutoff)
    : [];
}

function writeQueue(storage: Storage, queue: QueuedEvent[]): void {
  let bounded = queue.slice(-MAX_QUEUE_EVENTS);
  while (bounded.length > 0 && JSON.stringify(bounded).length > MAX_QUEUE_BYTES) bounded = bounded.slice(1);
  if (bounded.length === 0) storage.removeItem(QUEUE_KEY);
  else storage.setItem(QUEUE_KEY, JSON.stringify(bounded));
}

function clearFlushTimer(): void {
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = null;
  flushTimerDueAt = null;
}

function scheduleFlush(delay = 2_000): void {
  if (
    !runtime?.endpoint ||
    getConsent(runtime.storage) !== "enabled"
  ) return;
  const dueAt = Date.now() + Math.max(0, delay);
  if (flushTimer !== null) {
    if (flushTimerDueAt !== null && flushTimerDueAt <= dueAt) return;
    clearFlushTimer();
  }
  flushTimerDueAt = dueAt;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushTimerDueAt = null;
    void flushAnalytics();
  }, delay);
}

function retryQueuedEventsNow(): void {
  if (!runtime || getConsent(runtime.storage) !== "enabled") return;
  try {
    const now = Date.now();
    const queue = readQueue(runtime.storage);
    if (queue.length === 0) return;
    writeQueue(
      runtime.storage,
      queue.map((item) => ({ ...item, nextAttemptAt: now })),
    );
    scheduleFlush(0);
  } catch { /* Keep the app usable. */ }
}

function stopPendingAnalytics(storage: Storage): void {
  if (runtime?.storage !== storage) return;
  clearFlushTimer();
  if (activeRequest?.storage === storage) activeRequest.controller.abort();
}

function handleConsentStorageChange(event: StorageEvent): void {
  if (
    event.key === CONSENT_KEY &&
    event.newValue !== "enabled" &&
    runtime
  ) {
    stopPendingAnalytics(runtime.storage);
  }
}

function installFlushListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  window.addEventListener("online", retryQueuedEventsNow);
  window.addEventListener("storage", handleConsentStorageChange);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") scheduleFlush(0);
  });
}

export function initializeAnalytics(options: Omit<AnalyticsRuntime, "storage"> & { storage?: Storage }): void {
  runtime = { ...options, storage: options.storage ?? window.localStorage };
  installFlushListeners();
  if (getConsent(runtime.storage) !== "enabled") return;
  const previous = parseJson<Partial<SessionRecord>>(runtime.storage.getItem(SESSION_KEY));
  const session = readSession(runtime.storage, Date.now());
  runtime.storage.setItem(SESSION_KEY, JSON.stringify(session));
  if (previous?.id !== session.id) {
    trackAnalyticsOnce("session_started", {
      name: "session_started",
      properties: { install_evidence: getInstallEvidence(runtime.storage) },
    });
  }
  writeQueue(runtime.storage, readQueue(runtime.storage));
  scheduleFlush();
}

export function updateAnalyticsLanguage(language: AppLanguage): void {
  if (runtime) runtime.language = language;
}

export function enableAnalytics(): void {
  if (!runtime) return;
  const evidence = getInstallEvidence(runtime.storage);
  runtime.storage.setItem(CONSENT_KEY, "enabled");
  clearAnalyticsPromptState(runtime.storage);
  getInstallationId(runtime.storage);
  trackAnalyticsOnce("analytics_enabled", {
    name: "analytics_enabled",
    properties: { install_evidence: evidence },
  });
  trackAnalyticsOnce("session_started", {
    name: "session_started",
    properties: { install_evidence: evidence },
  });
}

export function deferAnalytics(
  storage: Storage = window.localStorage,
  now = Date.now(),
): void {
  try {
    storage.setItem(CONSENT_KEY, "deferred");
    recordAnalyticsPromptDeferral(storage, now);
  } catch { /* Keep the app usable. */ }
}

export function disableAnalytics(storage: Storage = window.localStorage): void {
  try {
    storage.setItem(CONSENT_KEY, "disabled");
    stopPendingAnalytics(storage);
    storage.removeItem(INSTALLATION_KEY);
    storage.removeItem(SESSION_KEY);
    storage.removeItem(QUEUE_KEY);
    clearAnalyticsPromptState(storage);
  } catch { /* Keep the app usable. */ }
}

export function resetAnalyticsForDevelopment(
  storage: Storage = window.localStorage,
): void {
  try {
    stopPendingAnalytics(storage);
    storage.removeItem(CONSENT_KEY);
    storage.removeItem(INSTALLATION_KEY);
    storage.removeItem(INSTALL_EVIDENCE_KEY);
    storage.removeItem(SESSION_KEY);
    storage.removeItem(QUEUE_KEY);
    clearAnalyticsPromptState(storage);
  } catch { /* Keep the app usable. */ }
}

function enqueue(event: AnalyticsEvent, onceKey?: string): void {
  if (!runtime || getConsent(runtime.storage) !== "enabled") return;
  try {
    const now = Date.now();
    const previousSession = parseJson<Partial<SessionRecord>>(
      runtime.storage.getItem(SESSION_KEY),
    );
    const session = readSession(runtime.storage, now);
    if (onceKey && session.onceKeys.includes(onceKey)) return;
    if (onceKey) session.onceKeys = [...session.onceKeys, onceKey].slice(-50);
    runtime.storage.setItem(SESSION_KEY, JSON.stringify(session));
    const installationId = getInstallationId(runtime.storage);
    const common = {
      schema_version: SCHEMA_VERSION,
      occurred_at: new Date(now).toISOString(),
      installation_id: installationId,
      session_id: session.id,
      app_version: runtime.appVersion,
      ui_language: runtime.language,
      environment: runtime.environment,
    };
    const queue = readQueue(runtime.storage);
    if (
      event.name !== "session_started" &&
      typeof previousSession?.id === "string" &&
      previousSession.id !== session.id
    ) {
      queue.push({
        event: {
          name: "session_started",
          properties: { install_evidence: getInstallEvidence(runtime.storage) },
          ...common,
          event_id: crypto.randomUUID(),
        },
        attempts: 0,
        nextAttemptAt: now,
      });
    }
    queue.push({
      event: { ...event, ...common, event_id: crypto.randomUUID() },
      attempts: 0,
      nextAttemptAt: now,
    });
    writeQueue(runtime.storage, queue);
    scheduleFlush();
  } catch (error) {
    console.warn("Failed to queue anonymous analytics event", error);
  }
}

export function trackAnalytics(event: AnalyticsEvent): void { enqueue(event); }
export function trackAnalyticsOnce(onceKey: string, event: AnalyticsEvent): void { enqueue(event, onceKey); }

export async function flushAnalytics(): Promise<void> {
  if (flushPromise) return flushPromise;
  if (!runtime?.endpoint || getConsent(runtime.storage) !== "enabled") return;
  clearFlushTimer();
  let nextFlushDelay: number | null = null;
  flushPromise = (async () => {
    const activeRuntime = runtime!;
    const queue = readQueue(activeRuntime.storage);
    const now = Date.now();
    const ready = queue.filter((item) => item.nextAttemptAt <= now).slice(0, MAX_BATCH_SIZE);
    if (ready.length === 0) {
      const next = queue.reduce(
        (minimum, item) => Math.min(minimum, item.nextAttemptAt),
        Number.POSITIVE_INFINITY,
      );
      if (Number.isFinite(next)) nextFlushDelay = Math.max(1_000, next - now);
      return;
    }
    const controller = new AbortController();
    activeRequest = { controller, storage: activeRuntime.storage };
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(activeRuntime.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: ready.map((item) => item.event) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error();
      const sentIds = new Set(ready.map((item) => item.event.event_id));
      const latestQueue = readQueue(activeRuntime.storage);
      const remaining = latestQueue.filter((item) => !sentIds.has(item.event.event_id));
      writeQueue(activeRuntime.storage, remaining);
      const next = remaining.reduce(
        (minimum, item) => Math.min(minimum, item.nextAttemptAt),
        Number.POSITIVE_INFINITY,
      );
      if (Number.isFinite(next)) nextFlushDelay = Math.max(0, next - Date.now());
    } catch {
      const attemptedIds = new Set(ready.map((item) => item.event.event_id));
      const updated = readQueue(activeRuntime.storage).flatMap((item) => {
        if (!attemptedIds.has(item.event.event_id)) return [item];
        const attempts = item.attempts + 1;
        if (attempts > RETRY_DELAYS_MS.length) return [];
        return [{ ...item, attempts, nextAttemptAt: now + RETRY_DELAYS_MS[attempts - 1] }];
      });
      writeQueue(activeRuntime.storage, updated);
      const next = updated.reduce((minimum, item) => Math.min(minimum, item.nextAttemptAt), Number.POSITIVE_INFINITY);
      if (Number.isFinite(next)) nextFlushDelay = Math.max(1_000, next - Date.now());
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest?.controller === controller) activeRequest = null;
    }
  })().finally(() => {
    flushPromise = null;
    if (nextFlushDelay !== null) scheduleFlush(nextFlushDelay);
  });
  return flushPromise;
}
