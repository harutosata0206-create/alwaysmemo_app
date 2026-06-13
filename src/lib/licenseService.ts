export type LicenseState = "free" | "plus_active" | "plus_expired" | "unknown";

export type PlusFeature =
  | "customThemes"
  | "customShortcuts"
  | "windowPresets"
  | "decorations";

let currentState: LicenseState = "free";
const listeners = new Set<(state: LicenseState) => void>();

export const getLicenseState = (): LicenseState => currentState;

export const canUsePlusFeature = (_feature: PlusFeature, state = currentState): boolean =>
  state === "plus_active";

export function setDevelopmentLicenseState(state: LicenseState): void {
  if (currentState === state) return;
  currentState = state;
  listeners.forEach((listener) => listener(state));
}

export function subscribeLicenseState(listener: (state: LicenseState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
