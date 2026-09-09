import type { AppLanguage } from "./i18n";

const CONSENT_KEY = "alwaysmemo-analytics-consent";
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
let flushPromise: Promise<void> | null = null;
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

export function shouldShowAnalyticsPrompt(storage: Storage = window.localStorage): boolean {
  return getAnalyticsConsent(storage) === "unset";
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

function scheduleFlush(delay = 2_000): void {
  if (!runtime?.endpoint || flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushAnalytics();
  }, delay);
}

function installFlushListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  window.addEventListener("online", () => scheduleFlush(0));
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

export function deferAnalytics(storage: Storage = window.localStorage): void {
  try { storage.setItem(CONSENT_KEY, "deferred"); } catch { /* Keep the app usable. */ }
}

export function disableAnalytics(storage: Storage = window.localStorage): void {
  try {
    storage.setItem(CONSENT_KEY, "disabled");
    storage.removeItem(INSTALLATION_KEY);
    storage.removeItem(SESSION_KEY);
    storage.removeItem(QUEUE_KEY);
  } catch { /* Keep the app usable. */ }
}

function enqueue(event: AnalyticsEvent, onceKey?: string): void {
  if (!runtime || getConsent(runtime.storage) !== "enabled") return;
  try {
    const now = Date.now();
    const session = readSession(runtime.storage, now);
    if (onceKey && session.onceKeys.includes(onceKey)) return;
    if (onceKey) session.onceKeys = [...session.onceKeys, onceKey].slice(-50);
    runtime.storage.setItem(SESSION_KEY, JSON.stringify(session));
    const storedEvent: StoredEvent = {
      ...event,
      schema_version: SCHEMA_VERSION,
      event_id: crypto.randomUUID(),
      occurred_at: new Date(now).toISOString(),
      installation_id: getInstallationId(runtime.storage),
      session_id: session.id,
      app_version: runtime.appVersion,
      ui_language: runtime.language,
      environment: runtime.environment,
    };
    const queue = readQueue(runtime.storage);
    queue.push({ event: storedEvent, attempts: 0, nextAttemptAt: now });
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
  flushPromise = (async () => {
    const activeRuntime = runtime!;
    const queue = readQueue(activeRuntime.storage);
    const now = Date.now();
    const ready = queue.filter((item) => item.nextAttemptAt <= now).slice(0, MAX_BATCH_SIZE);
    if (ready.length === 0) return;
    const controller = new AbortController();
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
      writeQueue(activeRuntime.storage, latestQueue.filter((item) => !sentIds.has(item.event.event_id)));
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
      if (Number.isFinite(next)) scheduleFlush(Math.max(1_000, next - Date.now()));
    } finally {
      window.clearTimeout(timeout);
    }
  })().finally(() => { flushPromise = null; });
  return flushPromise;
}
