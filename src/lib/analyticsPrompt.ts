export const ANALYTICS_PROMPT_STORAGE_KEY = "alwaysmemo-analytics-prompt";

const FIRST_REMINDER_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const FINAL_REMINDER_DELAY_MS = 30 * 24 * 60 * 60 * 1000;
const MINIMUM_USAGE_DAYS = 3;
const MAXIMUM_DEFERRALS = 3;

type AnalyticsPromptRecord = {
  deferralCount: number;
  firstDeferredAt: number;
  lastDeferredAt: number;
  usageDays: string[];
};

function getUsageDay(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function readRecord(storage: Storage): AnalyticsPromptRecord | null {
  const stored = storage.getItem(ANALYTICS_PROMPT_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<AnalyticsPromptRecord>;
    if (
      typeof parsed.deferralCount !== "number" ||
      !Number.isInteger(parsed.deferralCount) ||
      parsed.deferralCount < 1 ||
      parsed.deferralCount > MAXIMUM_DEFERRALS ||
      typeof parsed.firstDeferredAt !== "number" ||
      !Number.isFinite(parsed.firstDeferredAt) ||
      typeof parsed.lastDeferredAt !== "number" ||
      !Number.isFinite(parsed.lastDeferredAt) ||
      !Array.isArray(parsed.usageDays)
    ) {
      return null;
    }
    return {
      deferralCount: parsed.deferralCount,
      firstDeferredAt: parsed.firstDeferredAt,
      lastDeferredAt: parsed.lastDeferredAt,
      usageDays: parsed.usageDays
        .filter((value): value is string => typeof value === "string")
        .slice(-MINIMUM_USAGE_DAYS),
    };
  } catch {
    return null;
  }
}

function writeRecord(storage: Storage, record: AnalyticsPromptRecord): void {
  storage.setItem(ANALYTICS_PROMPT_STORAGE_KEY, JSON.stringify(record));
}

function createInitialRecord(now: number): AnalyticsPromptRecord {
  return {
    deferralCount: 1,
    firstDeferredAt: now,
    lastDeferredAt: now,
    usageDays: [getUsageDay(now)],
  };
}

export function recordAnalyticsPromptDeferral(storage: Storage, now = Date.now()): void {
  const previous = readRecord(storage);
  if (!previous) {
    writeRecord(storage, createInitialRecord(now));
    return;
  }
  writeRecord(storage, {
    ...previous,
    deferralCount: Math.min(previous.deferralCount + 1, MAXIMUM_DEFERRALS),
    lastDeferredAt: now,
    usageDays: Array.from(new Set([...previous.usageDays, getUsageDay(now)]))
      .slice(-MINIMUM_USAGE_DAYS),
  });
}

export function shouldShowDeferredAnalyticsPrompt(
  storage: Storage,
  now = Date.now(),
): boolean {
  let record = readRecord(storage);
  if (!record) {
    // Existing deferred users have no reminder record. Start their wait on upgrade.
    writeRecord(storage, createInitialRecord(now));
    return false;
  }

  const usageDays = Array.from(
    new Set([...record.usageDays, getUsageDay(now)]),
  ).slice(-MINIMUM_USAGE_DAYS);
  if (usageDays.length !== record.usageDays.length) {
    record = { ...record, usageDays };
    writeRecord(storage, record);
  }

  if (record.deferralCount >= MAXIMUM_DEFERRALS) return false;
  if (record.deferralCount === 1) {
    return (
      now - record.firstDeferredAt >= FIRST_REMINDER_DELAY_MS &&
      usageDays.length >= MINIMUM_USAGE_DAYS
    );
  }
  return now - record.lastDeferredAt >= FINAL_REMINDER_DELAY_MS;
}

export function clearAnalyticsPromptState(storage: Storage): void {
  storage.removeItem(ANALYTICS_PROMPT_STORAGE_KEY);
}
