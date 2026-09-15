import { resetAnalyticsForDevelopment } from "./analytics";
import { DEFAULT_APP_PROMPT_STORAGE_KEY } from "./defaultAppPrompt";
import { REVIEW_PROMPT_STORAGE_KEY } from "./reviewPrompt";
import type { DevelopmentResetTarget } from "./settingsBridge";

export const HELP_HINT_STORAGE_KEY = "alwaysmemo-help-hint-seen";
export const ONBOARDING_STORAGE_KEY = "alwaysmemo-onboarding-completed";

export function resetDevelopmentState(
  target: DevelopmentResetTarget,
  storage: Storage = window.localStorage,
): void {
  try {
    if (target === "analytics" || target === "all") {
      resetAnalyticsForDevelopment(storage);
    }
    if (target === "onboarding" || target === "all") {
      storage.removeItem(ONBOARDING_STORAGE_KEY);
    }
    if (target === "all") {
      storage.removeItem(HELP_HINT_STORAGE_KEY);
      storage.removeItem(DEFAULT_APP_PROMPT_STORAGE_KEY);
      storage.removeItem(REVIEW_PROMPT_STORAGE_KEY);
    }
  } catch { /* Keep the development build usable. */ }
}
