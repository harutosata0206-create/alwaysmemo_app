const DEFAULT_APP_PROMPT_STORAGE_KEY = "alwaysmemo-default-app-prompt";
const PROMPT_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

type DefaultAppPromptRecord = {
  promptShownAt?: number;
};

function readRecord(storage: Storage): DefaultAppPromptRecord | null {
  const stored = storage.getItem(DEFAULT_APP_PROMPT_STORAGE_KEY);
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<DefaultAppPromptRecord>;
    return {
      promptShownAt:
        typeof parsed.promptShownAt === "number" && Number.isFinite(parsed.promptShownAt)
          ? parsed.promptShownAt
          : undefined,
    };
  } catch {
    return null;
  }
}

export function shouldShowDefaultAppPrompt(storage: Storage, now = Date.now()): boolean {
  try {
    const record = readRecord(storage);
    if (record?.promptShownAt === undefined) return true;
    return now - record.promptShownAt >= PROMPT_INTERVAL_MS;
  } catch (error) {
    console.error("Failed to read default app prompt state", error);
    return false;
  }
}

export function markDefaultAppPromptShown(storage: Storage, now = Date.now()): void {
  try {
    storage.setItem(
      DEFAULT_APP_PROMPT_STORAGE_KEY,
      JSON.stringify({ promptShownAt: now }),
    );
  } catch (error) {
    console.error("Failed to save default app prompt state", error);
  }
}
