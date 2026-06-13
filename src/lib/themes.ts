import type { CSSProperties } from "react";
import type { AppLanguage } from "./i18n";

export type ThemeId =
  | "light"
  | "dark"
  | "system"
  | "midnight-blue"
  | "forest"
  | "sepia"
  | "lavender"
  | "sakura"
  | "slate"
  | "aqua";

export type ThemeColors = {
  appBackground: string;
  sidebarBackground: string;
  panelBackground: string;
  editorBackground: string;
  textPrimary: string;
  textSecondary: string;
  borderColor: string;
  accentColor: string;
  accentHover: string;
  selectionColor: string;
  inputBackground: string;
};

export type ThemeDefinition = {
  id: Exclude<ThemeId, "system">;
  names: Record<AppLanguage, string>;
  colors: ThemeColors;
  dark: boolean;
  plus: boolean;
};

const names = (
  ja: string,
  en: string,
  es: string,
  ptBR: string,
  ko: string,
): Record<AppLanguage, string> => ({ ja, en, es, "pt-BR": ptBR, ko });

export const THEMES: ThemeDefinition[] = [
  {
    id: "light",
    names: names("ライト", "Light", "Claro", "Claro", "라이트"),
    dark: false,
    plus: false,
    colors: {
      appBackground: "#F1F5F9", sidebarBackground: "#FFFFFF", panelBackground: "#F8FAFC",
      editorBackground: "#FFFFFF", textPrimary: "#111827", textSecondary: "#64748B",
      borderColor: "#D8E0EA", accentColor: "#2959E2", accentHover: "#3F70F0",
      selectionColor: "#BDD2FF", inputBackground: "#F2F5FA",
    },
  },
  {
    id: "dark",
    names: names("ダーク", "Dark", "Oscuro", "Escuro", "다크"),
    dark: true,
    plus: false,
    colors: {
      appBackground: "#071329", sidebarBackground: "#091A35", panelBackground: "#102243",
      editorBackground: "#0C1C38", textPrimary: "#F1F5FF", textSecondary: "#9EB5D8",
      borderColor: "#29446D", accentColor: "#3B73F1", accentHover: "#5588F5",
      selectionColor: "#31589B", inputBackground: "#172D53",
    },
  },
  {
    id: "midnight-blue",
    names: names("ミッドナイト", "Midnight", "Medianoche", "Meia-noite", "미드나이트"),
    dark: true,
    plus: true,
    colors: {
      appBackground: "#040B18", sidebarBackground: "#071225", panelBackground: "#0B1A31",
      editorBackground: "#061326", textPrimary: "#EAF2FF", textSecondary: "#8FA8CC",
      borderColor: "#203B63", accentColor: "#4B7CFF", accentHover: "#6691FF",
      selectionColor: "#294D99", inputBackground: "#102440",
    },
  },
  {
    id: "forest",
    names: names("フォレスト", "Forest", "Bosque", "Floresta", "포레스트"),
    dark: true,
    plus: true,
    colors: {
      appBackground: "#091713", sidebarBackground: "#0C211B", panelBackground: "#133329",
      editorBackground: "#0E271F", textPrimary: "#E8F5EE", textSecondary: "#9CC5B1",
      borderColor: "#2B5746", accentColor: "#4DAA7B", accentHover: "#68BE91",
      selectionColor: "#2E6A50", inputBackground: "#173D30",
    },
  },
  {
    id: "sepia",
    names: names("セピア", "Sepia", "Sepia", "Sépia", "세피아"),
    dark: false,
    plus: true,
    colors: {
      appBackground: "#EDE3D3", sidebarBackground: "#DED0BC", panelBackground: "#F5EBDD",
      editorBackground: "#FFF9ED", textPrimary: "#473A2D", textSecondary: "#806C58",
      borderColor: "#CDBA9F", accentColor: "#A66A3F", accentHover: "#BB7C4E",
      selectionColor: "#E0B98F", inputBackground: "#E9DCC8",
    },
  },
  {
    id: "lavender",
    names: names("ラベンダー", "Lavender", "Lavanda", "Lavanda", "라벤더"),
    dark: false,
    plus: true,
    colors: {
      appBackground: "#EEEAF7", sidebarBackground: "#DED7EE", panelBackground: "#F6F3FC",
      editorBackground: "#FCFAFF", textPrimary: "#3C354D", textSecondary: "#756A8D",
      borderColor: "#C8BCE0", accentColor: "#8268C7", accentHover: "#967DD5",
      selectionColor: "#CDBEF0", inputBackground: "#E7E0F3",
    },
  },
  {
    id: "sakura",
    names: names("サクラ", "Sakura", "Sakura", "Sakura", "사쿠라"),
    dark: false,
    plus: true,
    colors: {
      appBackground: "#FFF0F3", sidebarBackground: "#F5DDE4", panelBackground: "#FFF7F9",
      editorBackground: "#FFFBFC", textPrimary: "#4A323A", textSecondary: "#8A6873",
      borderColor: "#E8BBC8", accentColor: "#D86A87", accentHover: "#E3829B",
      selectionColor: "#F3BFD0", inputBackground: "#F8E5EA",
    },
  },
  {
    id: "slate",
    names: names("スレート", "Slate", "Pizarra", "Ardósia", "슬레이트"),
    dark: true,
    plus: true,
    colors: {
      appBackground: "#16191E", sidebarBackground: "#1B1F25", panelBackground: "#232830",
      editorBackground: "#1D2229", textPrimary: "#E5E7EB", textSecondary: "#9CA3AF",
      borderColor: "#3A414C", accentColor: "#8B9BAF", accentHover: "#A1ADBC",
      selectionColor: "#465361", inputBackground: "#2A3039",
    },
  },
  {
    id: "aqua",
    names: names("アクア", "Aqua", "Aqua", "Água", "아쿠아"),
    dark: false,
    plus: true,
    colors: {
      appBackground: "#EAF8FC", sidebarBackground: "#D6F0F7", panelBackground: "#F4FCFE",
      editorBackground: "#FBFEFF", textPrimary: "#263E46", textSecondary: "#5F7F89",
      borderColor: "#ADD8E5", accentColor: "#36A8C7", accentHover: "#52BAD5",
      selectionColor: "#AFE4F0", inputBackground: "#E0F4F8",
    },
  },
];

export const THEME_IDS: readonly ThemeId[] = [
  "light", "dark", "system", "midnight-blue", "forest",
  "sepia", "lavender", "sakura", "slate", "aqua",
];

export const getTheme = (id: ThemeId, systemDark = false): ThemeDefinition =>
  THEMES.find((theme) => theme.id === (id === "system" ? (systemDark ? "dark" : "light") : id))
  ?? THEMES[0];

export const getThemeName = (id: ThemeId, language: AppLanguage): string =>
  id === "system"
    ? ({ ja: "システム", en: "System", es: "Sistema", "pt-BR": "Sistema", ko: "시스템" })[language]
    : getTheme(id).names[language];

export const getThemeStyle = (theme: ThemeDefinition): CSSProperties => ({
  ["--theme-app" as string]: theme.colors.appBackground,
  ["--theme-sidebar" as string]: theme.colors.sidebarBackground,
  ["--theme-panel" as string]: theme.colors.panelBackground,
  ["--theme-editor" as string]: theme.colors.editorBackground,
  ["--theme-text" as string]: theme.colors.textPrimary,
  ["--theme-muted" as string]: theme.colors.textSecondary,
  ["--theme-border" as string]: theme.colors.borderColor,
  ["--theme-accent" as string]: theme.colors.accentColor,
  ["--theme-accent-hover" as string]: theme.colors.accentHover,
  ["--theme-selection" as string]: theme.colors.selectionColor,
  ["--theme-input" as string]: theme.colors.inputBackground,
});
