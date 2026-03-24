import { useEffect, useMemo, useState } from "react";

export const SUPPORTED_LANGUAGES = ["ja", "en"] as const;

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export type LanguagePreference = "system" | AppLanguage;

type HelpShortcut =
  | {
      label: string;
      keys: string[];
    }
  | {
      label: string;
      groups: string[][];
    };

type Messages = {
  common: {
    productName: string;
    on: string;
    off: string;
    windowControls: {
      minimize: string;
      maximize: string;
      restore: string;
      close: string;
    };
    languageOptions: {
      system: string;
      ja: string;
      en: string;
    };
  };
  app: {
    untitledTab: string;
    numberedMemo: (index: number) => string;
    defaultSaveName: string;
    textFileFilter: string;
    renameTabPrompt: string;
    tabCloseAria: {
      unsaved: string;
      close: string;
    };
    menu: {
      file: string;
      edit: string;
      view: string;
      newTab: string;
      newWindow: string;
      open: string;
      save: string;
      saveAs: string;
      saveAll: string;
      alwaysOnTop: string;
      globalShortcuts: string;
      closeTab: string;
      closeWindow: string;
      exit: string;
      undo: string;
      cut: string;
      copy: string;
      paste: string;
      find: string;
      replace: string;
      goTo: string;
      font: string;
      zoomIn: string;
      zoomOut: string;
      resetZoom: string;
      statusBar: string;
      wrapAtRightEdge: string;
      zoomInShortcut: string;
      zoomOutShortcut: string;
    };
    search: {
      searchPlaceholder: string;
      replacePlaceholder: string;
      count: (count: number) => string;
      close: string;
      replace: string;
      replaceAll: string;
    };
    help: {
      buttonLabel: string;
      hintLabel: string;
      closeHint: string;
      hintBody: string;
      panelLabel: string;
      title: string;
      closePanel: string;
      shortcutsTitle: string;
      pointsTitle: string;
      openDetailedHelp: string;
      shortcuts: HelpShortcut[];
      points: string[];
    };
    settingsButtonLabel: string;
    newTabButtonTitle: string;
    editorPlaceholder: string;
    dialogs: {
      confirmTitle: string;
      unsavedMemosBeforeExit: (count: number) => string;
      saveChangesTo: (target: string) => string;
      goToLineTitle: string;
      lineNumber: string;
      move: string;
      save: string;
      dontSave: string;
      cancel: string;
    };
    statusBar: {
      lineColumn: (line: number, column: number) => string;
      characters: (count: number) => string;
      encoding: string;
      alwaysOnTop: string;
      shortcuts: string;
    };
    windowTitles: {
      main: string;
      settings: string;
    };
    statuses: {
      disabledShortcutsMultiWindow: string;
      failedOpenNewWindow: string;
      opened: (title: string) => string;
      failedOpenFile: string;
      openingSaveDialog: string;
      saveDialogReturnedNoPath: string;
      savingTo: (path: string) => string;
      saved: (title: string) => string;
      failedSaveFile: (error: string) => string;
      noSavedFilesToUpdate: string;
      savedAll: string;
      failedSaveAll: string;
      alwaysOnTopEnabled: string;
      alwaysOnTopDisabled: string;
      failedSetAlwaysOnTop: string;
      failedOpenSettingsWindow: string;
      failedOpenDetailedHelp: string;
      failedToggleAlwaysOnTop: string;
      snappedLeft: string;
      failedSnapLeft: string;
      snappedRight: string;
      failedSnapRight: string;
      snappedTop: string;
      failedSnapTop: string;
      snappedBottom: string;
      failedSnapBottom: string;
      resizedMinimum: string;
      failedResizeMinimum: string;
      resizedFitContent: string;
      failedResizeFitContent: string;
      failedReadAlwaysOnTopState: string;
      clipboardUnavailable: string;
      hotkeyToggleAlwaysOnTop: string;
      hotkeySnapLeft: string;
      hotkeySnapRight: string;
      hotkeySnapTop: string;
      hotkeySnapBottom: string;
      globalShortcutError: (message: string) => string;
      globalShortcutsActive: string;
      localShortcutsActive: string;
      failedConfigureShortcuts: string;
    };
  };
    settings: {
      loading: string;
      navigation: {
        language: string;
        appearance: string;
        formatting: string;
        features: string;
        startup: string;
        about: string;
      };
      language: {
        title: string;
        description: string;
        label: string;
        helper: string;
      };
      appearance: {
        title: string;
        description: string;
        themeLabel: string;
        themeDescription: string;
        themeLight: string;
        themeDark: string;
      themeSystem: string;
    };
    formatting: {
      title: string;
      description: string;
      fontSizeLabel: string;
      fontSizeDescription: string;
      lineSpacingLabel: string;
      lineSpacingDescription: string;
      lineSpacingStandard: string;
      lineSpacingRelaxed: string;
      wrapLabel: string;
      wrapDescription: string;
      previewTitle: string;
      previewLine1: string;
      previewLine2: string;
    };
    features: {
      title: string;
      description: string;
      alwaysOnTopLabel: string;
      alwaysOnTopDescription: string;
      globalShortcutsLabel: string;
      globalShortcutsDescription: string;
    };
    startup: {
      title: string;
      description: string;
      sessionLabel: string;
      restoreSession: string;
      startNewSession: string;
      fileOpenLabel: string;
      openInExistingWindow: string;
      openInNewWindow: string;
    };
    about: {
      description: string;
      version: (version: string) => string;
      settingsWindow: string;
      license: string;
      linksLabel: string;
      help: string;
      terms: string;
      privacy: string;
    };
  };
};

const translations: Record<AppLanguage, Messages> = {
  ja: {
    common: {
      productName: "AlwaysMemo",
      on: "ON",
      off: "OFF",
      windowControls: {
        minimize: "最小化",
        maximize: "最大化",
        restore: "元に戻す",
        close: "閉じる",
      },
      languageOptions: {
        system: "システム",
        ja: "日本語",
        en: "English",
      },
    },
    app: {
      untitledTab: "タイトルなし",
      numberedMemo: (index) => `メモ ${index}`,
      defaultSaveName: "memo",
      textFileFilter: "テキスト",
      renameTabPrompt: "タブ名を変更",
      tabCloseAria: {
        unsaved: "未保存",
        close: "閉じる",
      },
      menu: {
        file: "ファイル",
        edit: "編集",
        view: "表示",
        newTab: "新しいタブ",
        newWindow: "新しいウィンドウ",
        open: "開く",
        save: "保存",
        saveAs: "名前を付けて保存",
        saveAll: "すべて保存",
        alwaysOnTop: "常に手前に表示",
        globalShortcuts: "グローバルショートカット",
        closeTab: "タブを閉じる",
        closeWindow: "ウィンドウを閉じる",
        exit: "終了",
        undo: "元に戻す",
        cut: "切り取り",
        copy: "コピー",
        paste: "貼り付け",
        find: "検索する",
        replace: "置換",
        goTo: "移動先",
        font: "フォント",
        zoomIn: "拡大",
        zoomOut: "縮小",
        resetZoom: "既定の倍率に戻す",
        statusBar: "ステータスバー",
        wrapAtRightEdge: "右端での折り返し",
        zoomInShortcut: "Ctrl+プラス記号 (+)",
        zoomOutShortcut: "Ctrl+マイナス記号 (-)",
      },
      search: {
        searchPlaceholder: "検索",
        replacePlaceholder: "置換",
        count: (count) => `${count} 件`,
        close: "検索を閉じる",
        replace: "置換",
        replaceAll: "すべて置換",
      },
      help: {
        buttonLabel: "ヘルプ",
        hintLabel: "ヘルプの案内",
        closeHint: "案内を閉じる",
        hintBody: "ショートカット一覧や機能の説明はこちらから",
        panelLabel: "ミニヘルプ",
        title: "ヘルプ",
        closePanel: "ヘルプを閉じる",
        shortcutsTitle: "よく使う操作",
        pointsTitle: "AlwaysMemo のポイント",
        openDetailedHelp: "詳しいヘルプを開く",
        shortcuts: [
          { keys: ["Ctrl", "Alt", "T"], label: "最前面表示の切り替え" },
          { groups: [["Ctrl", "Alt"], ["←", "↑", "→", "↓"]], label: "画面を移動" },
          { keys: ["Ctrl", "N"], label: "新しいメモ" },
          { keys: ["Ctrl", "W"], label: "メモを削除" },
        ],
        points: [
          "常に手前で表示できます",
          "グローバルショートカットを使用可能にしてください",
        ],
      },
      settingsButtonLabel: "設定",
      newTabButtonTitle: "新規タブ",
      editorPlaceholder: "ここにメモを書く",
      dialogs: {
        confirmTitle: "確認",
        unsavedMemosBeforeExit: (count) =>
          count > 1
            ? `${count} 件の未保存メモがあります。保存してから終了しますか？`
            : "未保存のメモがあります。保存してから終了しますか？",
        saveChangesTo: (target) => `${target} への変更内容を保存しますか？`,
        goToLineTitle: "行に移動",
        lineNumber: "行番号",
        move: "移動",
        save: "保存",
        dontSave: "保存しない",
        cancel: "キャンセル",
      },
      statusBar: {
        lineColumn: (line, column) => `行 ${line}, 列 ${column}`,
        characters: (count) => `${count} 文字`,
        encoding: "UTF-8",
        alwaysOnTop: "Top",
        shortcuts: "Shortcuts",
      },
      windowTitles: {
        main: "AlwaysMemo",
        settings: "AlwaysMemo 設定",
      },
      statuses: {
        disabledShortcutsMultiWindow: "複数ウィンドウのためグローバルショートカットをオフにしました",
        failedOpenNewWindow: "新しいウィンドウを開けませんでした",
        opened: (title) => `${title} を開きました`,
        failedOpenFile: "ファイルを開けませんでした",
        openingSaveDialog: "保存ダイアログを開いています...",
        saveDialogReturnedNoPath: "保存先が選択されませんでした",
        savingTo: (path) => `${path} に保存しています...`,
        saved: (title) => `${title} を保存しました`,
        failedSaveFile: (error) => `保存に失敗しました: ${error}`,
        noSavedFilesToUpdate: "更新できる保存済みファイルがありません",
        savedAll: "すべて保存しました",
        failedSaveAll: "一括保存に失敗しました",
        alwaysOnTopEnabled: "常に手前に表示を有効にしました",
        alwaysOnTopDisabled: "常に手前に表示を無効にしました",
        failedSetAlwaysOnTop: "常に手前に表示を設定できませんでした",
        failedOpenSettingsWindow: "設定ウィンドウを開けませんでした",
        failedOpenDetailedHelp: "詳細ヘルプを開けませんでした",
        failedToggleAlwaysOnTop: "常に手前に表示を切り替えられませんでした",
        snappedLeft: "左上に移動しました (ホットキー)",
        failedSnapLeft: "左への移動に失敗しました",
        snappedRight: "右上に移動しました (ホットキー)",
        failedSnapRight: "右への移動に失敗しました",
        snappedTop: "上端に移動しました (ホットキー)",
        failedSnapTop: "上への移動に失敗しました",
        snappedBottom: "下端に移動しました (ホットキー)",
        failedSnapBottom: "下への移動に失敗しました",
        resizedMinimum: "最小サイズに変更しました (ホットキー)",
        failedResizeMinimum: "最小サイズへの変更に失敗しました",
        resizedFitContent: "内容に合わせてサイズを変更しました (ホットキー)",
        failedResizeFitContent: "内容に合わせたサイズ変更に失敗しました",
        failedReadAlwaysOnTopState: "常に手前に表示の状態を取得できませんでした",
        clipboardUnavailable: "クリップボードにアクセスできませんでした",
        hotkeyToggleAlwaysOnTop: "ホットキー: 常に手前に表示を切り替えました",
        hotkeySnapLeft: "ホットキー: 左に移動しました",
        hotkeySnapRight: "ホットキー: 右に移動しました",
        hotkeySnapTop: "ホットキー: 上に移動しました",
        hotkeySnapBottom: "ホットキー: 下に移動しました",
        globalShortcutError: (message) => `グローバルショートカットのエラー: ${message}`,
        globalShortcutsActive: "グローバルショートカットが有効です",
        localShortcutsActive: "ローカルショートカットが有効です (ウィンドウ選択中)",
        failedConfigureShortcuts: "ショートカットの設定に失敗しました",
      },
    },
    settings: {
      loading: "設定を読み込んでいます...",
      navigation: {
        language: "言語",
        appearance: "外観",
        formatting: "書式設定",
        features: "機能",
        startup: "起動時",
        about: "情報",
      },
      language: {
        title: "言語",
        description: "アプリの表示言語を切り替えます。",
        label: "表示言語",
        helper: "システムを選ぶと OS の表示言語に合わせます",
      },
      appearance: {
        title: "外観",
        description: "メモ画面の見た目を調整します。",
        themeLabel: "テーマ",
        themeDescription: "アプリの配色を切り替えます",
        themeLight: "ライト",
        themeDark: "ダーク",
        themeSystem: "システム",
      },
      formatting: {
        title: "書式設定",
        description: "テキストの表示や構造を調整します。",
        fontSizeLabel: "文字サイズ",
        fontSizeDescription: "読みやすさに合わせて調整します",
        lineSpacingLabel: "行間",
        lineSpacingDescription: "行どうしの間隔を調整します",
        lineSpacingStandard: "標準",
        lineSpacingRelaxed: "広い",
        wrapLabel: "折り返し",
        wrapDescription: "長い行を自動で折り返します",
        previewTitle: "プレビュー:",
        previewLine1: "alwaysmemoの表示サンプルです。",
        previewLine2: "この文章は折り返し設定の確認用に、少し長めのテキストを表示しています。",
      },
      features: {
        title: "機能",
        description: "作業効率を高める機能を設定します。",
        alwaysOnTopLabel: "常に手前に表示",
        alwaysOnTopDescription: "他のアプリより前面に表示します",
        globalShortcutsLabel: "グローバルショートカット",
        globalShortcutsDescription: "OS 全体から操作を呼び出せます",
      },
      startup: {
        title: "起動時",
        description: "起動時の動作を設定します。",
        sessionLabel: "セッション",
        restoreSession: "前回の状態を復元",
        startNewSession: "常に新規で開始",
        fileOpenLabel: "ファイルの開き方",
        openInExistingWindow: "既存ウィンドウに追加",
        openInNewWindow: "新しいウィンドウで開く",
      },
      about: {
        description: "作業を中断せず、必要なメモをすぐ残せるツールです。",
        version: (version) => `バージョン ${version}`,
        settingsWindow: "設定ウィンドウ",
        license: "MIT ライセンス",
        linksLabel: "AlwaysMemo の関連ページ",
        help: "ヘルプ",
        terms: "利用規約",
        privacy: "プライバシー",
      },
    },
  },
  en: {
    common: {
      productName: "AlwaysMemo",
      on: "ON",
      off: "OFF",
      windowControls: {
        minimize: "Minimize",
        maximize: "Maximize",
        restore: "Restore",
        close: "Close",
      },
      languageOptions: {
        system: "System",
        ja: "Japanese",
        en: "English",
      },
    },
    app: {
      untitledTab: "Untitled",
      numberedMemo: (index) => `Memo ${index}`,
      defaultSaveName: "memo",
      textFileFilter: "Text",
      renameTabPrompt: "Rename tab",
      tabCloseAria: {
        unsaved: "Unsaved",
        close: "Close",
      },
      menu: {
        file: "File",
        edit: "Edit",
        view: "View",
        newTab: "New Tab",
        newWindow: "New Window",
        open: "Open",
        save: "Save",
        saveAs: "Save As",
        saveAll: "Save All",
        alwaysOnTop: "Always on Top",
        globalShortcuts: "Global Shortcuts",
        closeTab: "Close Tab",
        closeWindow: "Close Window",
        exit: "Exit",
        undo: "Undo",
        cut: "Cut",
        copy: "Copy",
        paste: "Paste",
        find: "Find",
        replace: "Replace",
        goTo: "Go To",
        font: "Font",
        zoomIn: "Zoom In",
        zoomOut: "Zoom Out",
        resetZoom: "Reset Zoom",
        statusBar: "Status Bar",
        wrapAtRightEdge: "Word Wrap",
        zoomInShortcut: "Ctrl+Plus (+)",
        zoomOutShortcut: "Ctrl+Minus (-)",
      },
      search: {
        searchPlaceholder: "Search",
        replacePlaceholder: "Replace",
        count: (count) => `${count} matches`,
        close: "Close search",
        replace: "Replace",
        replaceAll: "Replace All",
      },
      help: {
        buttonLabel: "Help",
        hintLabel: "Help hint",
        closeHint: "Dismiss hint",
        hintBody: "Open shortcut tips and feature notes from here",
        panelLabel: "Mini help",
        title: "Help",
        closePanel: "Close help",
        shortcutsTitle: "Common Actions",
        pointsTitle: "Why AlwaysMemo",
        openDetailedHelp: "Open full help",
        shortcuts: [
          { keys: ["Ctrl", "Alt", "T"], label: "Toggle always on top" },
          { groups: [["Ctrl", "Alt"], ["←", "↑", "→", "↓"]], label: "Move the window" },
          { keys: ["Ctrl", "N"], label: "Create a new memo" },
          { keys: ["Ctrl", "W"], label: "Delete the current memo" },
        ],
        points: [
          "Keep your memo above other apps when you need it",
          "Turn on global shortcuts to control it from anywhere",
        ],
      },
      settingsButtonLabel: "Settings",
      newTabButtonTitle: "New Tab",
      editorPlaceholder: "Write your memo here",
      dialogs: {
        confirmTitle: "Confirm",
        unsavedMemosBeforeExit: (count) =>
          count > 1
            ? `You have ${count} unsaved memos. Save them before closing?`
            : "You have an unsaved memo. Save it before closing?",
        saveChangesTo: (target) => `Save changes to ${target}?`,
        goToLineTitle: "Go to Line",
        lineNumber: "Line number",
        move: "Move",
        save: "Save",
        dontSave: "Don't Save",
        cancel: "Cancel",
      },
      statusBar: {
        lineColumn: (line, column) => `Ln ${line}, Col ${column}`,
        characters: (count) => `${count} chars`,
        encoding: "UTF-8",
        alwaysOnTop: "Top",
        shortcuts: "Shortcuts",
      },
      windowTitles: {
        main: "AlwaysMemo",
        settings: "AlwaysMemo Settings",
      },
      statuses: {
        disabledShortcutsMultiWindow: "Global shortcuts were turned off because multiple windows are open",
        failedOpenNewWindow: "Failed to open a new window",
        opened: (title) => `Opened ${title}`,
        failedOpenFile: "Failed to open the file",
        openingSaveDialog: "Opening the save dialog...",
        saveDialogReturnedNoPath: "No save location was selected",
        savingTo: (path) => `Saving to ${path}...`,
        saved: (title) => `Saved ${title}`,
        failedSaveFile: (error) => `Failed to save the file: ${error}`,
        noSavedFilesToUpdate: "There are no saved files to update",
        savedAll: "Saved all files",
        failedSaveAll: "Failed to save all files",
        alwaysOnTopEnabled: "Always on top enabled",
        alwaysOnTopDisabled: "Always on top disabled",
        failedSetAlwaysOnTop: "Failed to update always-on-top",
        failedOpenSettingsWindow: "Failed to open the settings window",
        failedOpenDetailedHelp: "Failed to open detailed help",
        failedToggleAlwaysOnTop: "Failed to toggle always-on-top",
        snappedLeft: "Snapped to the top-left (hotkey)",
        failedSnapLeft: "Failed to snap left",
        snappedRight: "Snapped to the top-right (hotkey)",
        failedSnapRight: "Failed to snap right",
        snappedTop: "Snapped to the top edge (hotkey)",
        failedSnapTop: "Failed to snap to the top edge",
        snappedBottom: "Snapped to the bottom edge (hotkey)",
        failedSnapBottom: "Failed to snap to the bottom edge",
        resizedMinimum: "Resized to the minimum size (hotkey)",
        failedResizeMinimum: "Failed to resize to the minimum size",
        resizedFitContent: "Resized to fit the content (hotkey)",
        failedResizeFitContent: "Failed to resize to fit the content",
        failedReadAlwaysOnTopState: "Failed to read the always-on-top state",
        clipboardUnavailable: "Clipboard access is unavailable",
        hotkeyToggleAlwaysOnTop: "Hotkey: toggled always-on-top",
        hotkeySnapLeft: "Hotkey: snapped left",
        hotkeySnapRight: "Hotkey: snapped right",
        hotkeySnapTop: "Hotkey: snapped to the top edge",
        hotkeySnapBottom: "Hotkey: snapped to the bottom edge",
        globalShortcutError: (message) => `Global shortcut error: ${message}`,
        globalShortcutsActive: "Global shortcuts are active",
        localShortcutsActive: "Local shortcuts are active (window focused)",
        failedConfigureShortcuts: "Failed to configure shortcuts",
      },
    },
    settings: {
      loading: "Loading settings...",
      navigation: {
        language: "Language",
        appearance: "Appearance",
        formatting: "Formatting",
        features: "Features",
        startup: "Startup",
        about: "About",
      },
      language: {
        title: "Language",
        description: "Choose the language used across the app.",
        label: "Display Language",
        helper: "Pick System to follow your OS display language",
      },
      appearance: {
        title: "Appearance",
        description: "Adjust how your memo window looks.",
        themeLabel: "Theme",
        themeDescription: "Choose the app color theme",
        themeLight: "Light",
        themeDark: "Dark",
        themeSystem: "System",
      },
      formatting: {
        title: "Formatting",
        description: "Tune how text is displayed and structured.",
        fontSizeLabel: "Font Size",
        fontSizeDescription: "Adjust it to match your reading comfort",
        lineSpacingLabel: "Line Spacing",
        lineSpacingDescription: "Control the space between lines",
        lineSpacingStandard: "Standard",
        lineSpacingRelaxed: "Relaxed",
        wrapLabel: "Wrap Text",
        wrapDescription: "Automatically wrap long lines",
        previewTitle: "Preview:",
        previewLine1: "This is a display sample for AlwaysMemo.",
        previewLine2: "This sentence is intentionally a little longer so you can check how wrapping looks.",
      },
      features: {
        title: "Features",
        description: "Configure features that help you work faster.",
        alwaysOnTopLabel: "Always on Top",
        alwaysOnTopDescription: "Keep the window above other apps",
        globalShortcutsLabel: "Global Shortcuts",
        globalShortcutsDescription: "Control the app from anywhere in the OS",
      },
      startup: {
        title: "Startup",
        description: "Choose what happens when the app starts.",
        sessionLabel: "Session",
        restoreSession: "Restore the previous state",
        startNewSession: "Always start fresh",
        fileOpenLabel: "Opening Files",
        openInExistingWindow: "Add to the current window",
        openInNewWindow: "Open in a new window",
      },
      about: {
        description: "A memo tool that lets you capture ideas right away without breaking your flow.",
        version: (version) => `Version ${version}`,
        settingsWindow: "Settings window",
        license: "MIT License",
        linksLabel: "AlwaysMemo links",
        help: "Help",
        terms: "Terms",
        privacy: "Privacy",
      },
    },
  },
};

const untitledTitles = new Set(
  SUPPORTED_LANGUAGES.map((language) => translations[language].app.untitledTab),
);

export function resolveSystemLanguage(locales?: readonly string[]): AppLanguage {
  const fallbackLocales =
    typeof navigator !== "undefined"
      ? (navigator.languages?.length ? navigator.languages : [navigator.language])
      : [];
  const candidates = locales ?? fallbackLocales;

  for (const locale of candidates) {
    const normalized = locale.toLowerCase();
    if (normalized.startsWith("ja")) return "ja";
    if (normalized.startsWith("en")) return "en";
  }

  return "en";
}

export function resolveLanguagePreference(preference: LanguagePreference): AppLanguage {
  return preference === "system" ? resolveSystemLanguage() : preference;
}

export function useResolvedLanguage(preference: LanguagePreference): AppLanguage {
  const [systemLanguage, setSystemLanguage] = useState<AppLanguage>(() => resolveSystemLanguage());

  useEffect(() => {
    const syncLanguage = () => {
      setSystemLanguage(resolveSystemLanguage());
    };

    syncLanguage();
    window.addEventListener("languagechange", syncLanguage);
    return () => window.removeEventListener("languagechange", syncLanguage);
  }, []);

  return useMemo(
    () => (preference === "system" ? systemLanguage : preference),
    [preference, systemLanguage],
  );
}

export function getMessages(language: AppLanguage): Messages {
  return translations[language];
}

export function useMessages(preference: LanguagePreference) {
  const language = useResolvedLanguage(preference);
  const messages = useMemo(() => getMessages(language), [language]);
  return { language, messages };
}

export function isUntitledTitle(title: string): boolean {
  return untitledTitles.has(title.trim());
}
