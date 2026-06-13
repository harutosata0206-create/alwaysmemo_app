import { invoke } from "@tauri-apps/api/core";
import type { SettingsSnapshot } from "./settingsBridge";
import { THEME_IDS } from "./themes";

export const SETTINGS_SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS: SettingsSnapshot = {
  alwaysOnTop: false,
  useGlobalShortcuts: true,
  showStatusBar: true,
  wrapAtRightEdge: true,
  editorFontSizePx: 14,
  lineSpacing: "standard",
  themeMode: "system",
  sessionBehavior: "restore",
  fileOpenBehavior: "existing",
  languagePreference: "system",
};

type SettingsDocument = {
  schemaVersion: number;
  settings: SettingsSnapshot;
};

let saveQueue: Promise<void> = Promise.resolve();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && values.includes(value as T);

function normalizeSettings(value: unknown): SettingsSnapshot {
  const source = isRecord(value) ? value : {};
  const fontSize = typeof source.editorFontSizePx === "number"
    ? Math.min(72, Math.max(8, source.editorFontSizePx))
    : DEFAULT_SETTINGS.editorFontSizePx;

  return {
    alwaysOnTop: typeof source.alwaysOnTop === "boolean"
      ? source.alwaysOnTop
      : DEFAULT_SETTINGS.alwaysOnTop,
    useGlobalShortcuts: typeof source.useGlobalShortcuts === "boolean"
      ? source.useGlobalShortcuts
      : DEFAULT_SETTINGS.useGlobalShortcuts,
    showStatusBar: typeof source.showStatusBar === "boolean"
      ? source.showStatusBar
      : DEFAULT_SETTINGS.showStatusBar,
    wrapAtRightEdge: typeof source.wrapAtRightEdge === "boolean"
      ? source.wrapAtRightEdge
      : DEFAULT_SETTINGS.wrapAtRightEdge,
    editorFontSizePx: fontSize,
    lineSpacing: isOneOf(source.lineSpacing, ["standard", "relaxed"])
      ? source.lineSpacing
      : DEFAULT_SETTINGS.lineSpacing,
    themeMode: isOneOf(source.themeMode, THEME_IDS)
      ? source.themeMode
      : DEFAULT_SETTINGS.themeMode,
    sessionBehavior: isOneOf(source.sessionBehavior, ["restore", "new"])
      ? source.sessionBehavior
      : DEFAULT_SETTINGS.sessionBehavior,
    fileOpenBehavior: isOneOf(source.fileOpenBehavior, ["existing", "new_window"])
      ? source.fileOpenBehavior
      : DEFAULT_SETTINGS.fileOpenBehavior,
    languagePreference: isOneOf(source.languagePreference, ["system", "ja", "en", "es", "pt-BR", "ko"])
      ? source.languagePreference
      : DEFAULT_SETTINGS.languagePreference,
  };
}

export function migrateSettingsDocument(value: unknown, legacySettings?: unknown): SettingsDocument {
  if (isRecord(value) && typeof value.schemaVersion === "number" && isRecord(value.settings)) {
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: normalizeSettings(value.settings),
    };
  }
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    settings: normalizeSettings(isRecord(value) ? value : legacySettings),
  };
}

export async function loadSettings(legacySettings?: unknown): Promise<SettingsSnapshot> {
  let stored: unknown = null;
  try {
    stored = await invoke<unknown | null>("read_settings_file");
  } catch (error) {
    console.error("Failed to read settings file", error);
  }
  return migrateSettingsDocument(stored, legacySettings).settings;
}

export function saveSettings(settings: SettingsSnapshot): Promise<void> {
  const document: SettingsDocument = {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    settings: normalizeSettings(settings),
  };
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(() => invoke<void>("write_settings_file", { settings: document }));
  return saveQueue;
}
