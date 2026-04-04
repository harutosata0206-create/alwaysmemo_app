export type SessionBehavior = "restore" | "new";
export type FileOpenBehavior = "existing" | "new_window";
export type LineSpacing = "standard" | "relaxed";
export type ThemeMode = "light" | "dark" | "system";
export type LanguagePreference = "system" | "ja" | "en" | "es" | "pt-BR";

export type SettingsSnapshot = {
  alwaysOnTop: boolean;
  useGlobalShortcuts: boolean;
  showStatusBar: boolean;
  wrapAtRightEdge: boolean;
  editorFontSizePx: number;
  lineSpacing: LineSpacing;
  themeMode: ThemeMode;
  sessionBehavior: SessionBehavior;
  fileOpenBehavior: FileOpenBehavior;
  languagePreference: LanguagePreference;
};

export type SettingsPatch = Partial<SettingsSnapshot>;

export type SettingsRequestPayload = {
  settingsLabel: string;
};

export type SettingsSyncPayload = {
  sourceLabel: string;
  snapshot: SettingsSnapshot;
};

export type SettingsUpdatePayload = {
  settingsLabel: string;
  patch: SettingsPatch;
};

export const SETTINGS_REQUEST_EVENT = "alwaysmemo:settings-request";
export const SETTINGS_SYNC_EVENT = "alwaysmemo:settings-sync";
export const SETTINGS_UPDATE_EVENT = "alwaysmemo:settings-update";

export const createSettingsWindowLabel = (sourceLabel: string) =>
  `alwaysmemo-settings-${sourceLabel}`;

export const isSettingsWindowLabel = (label: string) =>
  label === "settings" || label.startsWith("alwaysmemo-settings-");
