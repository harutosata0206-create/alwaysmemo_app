const REVIEW_PROMPT_STORAGE_KEY = "alwaysmemo-review-prompt";
const MINIMUM_FIRST_LAUNCH_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MINIMUM_LAUNCH_COUNT = 8;
const MINIMUM_USAGE_DAYS = 3;

type ReviewPromptRecord = {
  firstLaunchAt: number;
  launchCount: number;
  usageDays: string[];
  promptShownAt?: number;
  currentSessionHadError: boolean;
};

function getUsageDay(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function readRecord(storage: Storage): ReviewPromptRecord | null {
  const stored = storage.getItem(REVIEW_PROMPT_STORAGE_KEY);
  if (!stored) return null;
  let parsed: Partial<ReviewPromptRecord>;
  try {
    parsed = JSON.parse(stored) as Partial<ReviewPromptRecord>;
  } catch {
    return null;
  }
  const firstLaunchAt = parsed.firstLaunchAt;
  const launchCount = parsed.launchCount;
  if (
    typeof firstLaunchAt !== "number" ||
    !Number.isFinite(firstLaunchAt) ||
    typeof launchCount !== "number" ||
    !Number.isFinite(launchCount) ||
    !Array.isArray(parsed.usageDays)
  ) {
    return null;
  }
  return {
    firstLaunchAt,
    launchCount,
    usageDays: parsed.usageDays.filter((day): day is string => typeof day === "string"),
    promptShownAt: typeof parsed.promptShownAt === "number" ? parsed.promptShownAt : undefined,
    currentSessionHadError: parsed.currentSessionHadError === true,
  };
}

export function startReviewPromptSession(storage: Storage, now = Date.now()): boolean {
  try {
    const previous = readRecord(storage);
    const usageDays = Array.from(
      new Set([...(previous?.usageDays ?? []), getUsageDay(now)]),
    ).slice(-MINIMUM_USAGE_DAYS);
    const record: ReviewPromptRecord = {
      firstLaunchAt: previous?.firstLaunchAt ?? now,
      launchCount: (previous?.launchCount ?? 0) + 1,
      usageDays,
      promptShownAt: previous?.promptShownAt,
      currentSessionHadError: false,
    };
    const shouldShow =
      now - record.firstLaunchAt >= MINIMUM_FIRST_LAUNCH_AGE_MS &&
      record.launchCount >= MINIMUM_LAUNCH_COUNT &&
      usageDays.length >= MINIMUM_USAGE_DAYS &&
      record.promptShownAt === undefined &&
      previous?.currentSessionHadError !== true;

    if (shouldShow) {
      record.promptShownAt = now;
    }
    storage.setItem(REVIEW_PROMPT_STORAGE_KEY, JSON.stringify(record));
    return shouldShow;
  } catch (error) {
    console.error("Failed to update review prompt state", error);
    return false;
  }
}

export function markReviewSessionError(storage: Storage): void {
  try {
    const record = readRecord(storage);
    if (!record || record.currentSessionHadError) return;
    storage.setItem(
      REVIEW_PROMPT_STORAGE_KEY,
      JSON.stringify({ ...record, currentSessionHadError: true }),
    );
  } catch (error) {
    console.error("Failed to record review prompt session error", error);
  }
}
