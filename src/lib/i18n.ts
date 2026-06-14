import { useEffect, useMemo, useState } from "react";

export const SUPPORTED_LANGUAGES = ["ja", "en", "es", "pt-BR", "ko"] as const;

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
      es: string;
      "pt-BR": string;
      ko: string;
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
      recentFiles: string;
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
    onboarding: {
      skip: string;
      next: string;
      finish: string;
      tested: string;
      steps: Record<
        "snap" | "alwaysOnTop" | "fitContent" | "focus",
        { title: string; shortcutLabel: string; body: string; instruction: string }
      >;
    };
    reviewPrompt: {
      title: string;
      body: string;
      later: string;
      review: string;
      close: string;
    };
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
        es: "Español",
        "pt-BR": "Português (Brasil)",
        ko: "한국어",
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
        recentFiles: "新着順",
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
      onboarding: {
        skip: "スキップ",
        next: "次へ",
        finish: "完了",
        tested: "ショートカットを確認しました",
        steps: {
          snap: { title: "ウィンドウをすばやく移動", shortcutLabel: "移動ショートカット", body: "矢印キーに合わせて、AlwaysMemoを画面内の好きな位置へ移動できます。", instruction: "実際に押して試してください。" },
          alwaysOnTop: { title: "メモを常に手前に表示", shortcutLabel: "最前面表示ショートカット", body: "他のアプリを操作している間も、AlwaysMemoを手前に表示できます。", instruction: "ショートカットを押して試してください。" },
          fitContent: { title: "内容に合わせてサイズ調整", shortcutLabel: "サイズ調整ショートカット", body: "メモの内容に合わせて、ウィンドウサイズをすばやく整えます。", instruction: "ショートカットを押して試してください。" },
          focus: { title: "いつでもメモへ戻る", shortcutLabel: "フォーカスショートカット", body: "他のアプリからAlwaysMemoを呼び出し、そのまま本文へ入力できます。", instruction: "ショートカットを押して試してください。" },
        },
      },
      reviewPrompt: {
        title: "AlwaysMemoは役立っていますか？",
        body: "評価やご意見をいただけると、今後の改善の助けになります。",
        later: "あとで",
        review: "評価する",
        close: "レビュー依頼を閉じる",
      },
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
        es: "Spanish",
        "pt-BR": "Portuguese (Brazil)",
        ko: "Korean",
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
        recentFiles: "Recent Files",
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
      onboarding: {
        skip: "Skip",
        next: "Next",
        finish: "Finish",
        tested: "Shortcut confirmed",
        steps: {
          snap: { title: "Move the window instantly", shortcutLabel: "Window movement shortcut", body: "Use an arrow key to quickly move AlwaysMemo around the screen.", instruction: "Try the shortcut now." },
          alwaysOnTop: { title: "Keep your memo in front", shortcutLabel: "Always on top shortcut", body: "Keep AlwaysMemo visible while working in other apps.", instruction: "Try the shortcut now." },
          fitContent: { title: "Fit the window to your memo", shortcutLabel: "Fit content shortcut", body: "Quickly resize the window to match the memo content.", instruction: "Try the shortcut now." },
          focus: { title: "Return to your memo anytime", shortcutLabel: "Focus shortcut", body: "Bring back AlwaysMemo from another app and type immediately.", instruction: "Try the shortcut now." },
        },
      },
      reviewPrompt: {
        title: "Is AlwaysMemo useful to you?",
        body: "Your rating and feedback help us improve AlwaysMemo.",
        later: "Later",
        review: "Rate AlwaysMemo",
        close: "Close review request",
      },
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
  es: {
    common: {
      productName: "AlwaysMemo",
      on: "ON",
      off: "OFF",
      windowControls: {
        minimize: "Minimizar",
        maximize: "Maximizar",
        restore: "Restaurar",
        close: "Cerrar",
      },
      languageOptions: {
        system: "Sistema",
        ja: "Japonés",
        en: "Inglés",
        es: "Español",
        "pt-BR": "Portugués (Brasil)",
        ko: "Coreano",
      },
    },
    app: {
      untitledTab: "Sin título",
      numberedMemo: (index) => `Memo ${index}`,
      defaultSaveName: "memo",
      textFileFilter: "Texto",
      renameTabPrompt: "Renombrar pestaña",
      tabCloseAria: {
        unsaved: "Sin guardar",
        close: "Cerrar",
      },
      menu: {
        file: "Archivo",
        edit: "Editar",
        view: "Ver",
        newTab: "Nueva pestaña",
        newWindow: "Nueva ventana",
        open: "Abrir",
        recentFiles: "Archivos recientes",
        save: "Guardar",
        saveAs: "Guardar como",
        saveAll: "Guardar todo",
        alwaysOnTop: "Siempre visible",
        globalShortcuts: "Atajos globales",
        closeTab: "Cerrar pestaña",
        closeWindow: "Cerrar ventana",
        exit: "Salir",
        undo: "Deshacer",
        cut: "Cortar",
        copy: "Copiar",
        paste: "Pegar",
        find: "Buscar",
        replace: "Reemplazar",
        goTo: "Ir a",
        font: "Fuente",
        zoomIn: "Acercar",
        zoomOut: "Alejar",
        resetZoom: "Restablecer zoom",
        statusBar: "Barra de estado",
        wrapAtRightEdge: "Ajuste de línea",
        zoomInShortcut: "Ctrl+Más (+)",
        zoomOutShortcut: "Ctrl+Menos (-)",
      },
      search: {
        searchPlaceholder: "Buscar",
        replacePlaceholder: "Reemplazar",
        count: (count) => `${count} coincidencias`,
        close: "Cerrar búsqueda",
        replace: "Reemplazar",
        replaceAll: "Reemplazar todo",
      },
      help: {
        buttonLabel: "Ayuda",
        hintLabel: "Sugerencia de ayuda",
        closeHint: "Cerrar sugerencia",
        hintBody: "Abre consejos de atajos y notas de funciones desde aquí",
        panelLabel: "Ayuda rápida",
        title: "Ayuda",
        closePanel: "Cerrar ayuda",
        shortcutsTitle: "Acciones frecuentes",
        pointsTitle: "Por qué AlwaysMemo",
        openDetailedHelp: "Abrir ayuda completa",
        shortcuts: [
          { keys: ["Ctrl", "Alt", "T"], label: "Activar o desactivar siempre visible" },
          { groups: [["Ctrl", "Alt"], ["←", "↑", "→", "↓"]], label: "Mover la ventana" },
          { keys: ["Ctrl", "N"], label: "Crear un memo nuevo" },
          { keys: ["Ctrl", "W"], label: "Eliminar el memo actual" },
        ],
        points: [
          "Mantén tu memo sobre otras apps cuando lo necesites",
          "Activa los atajos globales para controlarlo desde cualquier lugar",
        ],
      },
      settingsButtonLabel: "Configuración",
      newTabButtonTitle: "Nueva pestaña",
      editorPlaceholder: "Escribe tu memo aquí",
      onboarding: {
        skip: "Omitir",
        next: "Siguiente",
        finish: "Finalizar",
        tested: "Atajo confirmado",
        steps: {
          snap: { title: "Mueve la ventana al instante", shortcutLabel: "Atajo para mover la ventana", body: "Usa una flecha para mover AlwaysMemo rápidamente por la pantalla.", instruction: "Prueba el atajo ahora." },
          alwaysOnTop: { title: "Mantén el memo al frente", shortcutLabel: "Atajo siempre visible", body: "Mantén AlwaysMemo visible mientras trabajas en otras aplicaciones.", instruction: "Prueba el atajo ahora." },
          fitContent: { title: "Ajusta la ventana al memo", shortcutLabel: "Atajo para ajustar el contenido", body: "Ajusta rápidamente la ventana al contenido del memo.", instruction: "Prueba el atajo ahora." },
          focus: { title: "Vuelve al memo en cualquier momento", shortcutLabel: "Atajo para enfocar", body: "Abre AlwaysMemo desde otra aplicación y escribe de inmediato.", instruction: "Prueba el atajo ahora." },
        },
      },
      reviewPrompt: {
        title: "¿AlwaysMemo te resulta útil?",
        body: "Tu valoración y comentarios nos ayudan a mejorar AlwaysMemo.",
        later: "Más tarde",
        review: "Valorar",
        close: "Cerrar solicitud de valoración",
      },
      dialogs: {
        confirmTitle: "Confirmar",
        unsavedMemosBeforeExit: (count) =>
          count > 1
            ? `Tienes ${count} memos sin guardar. ¿Quieres guardarlos antes de cerrar?`
            : "Tienes un memo sin guardar. ¿Quieres guardarlo antes de cerrar?",
        saveChangesTo: (target) => `¿Guardar los cambios en ${target}?`,
        goToLineTitle: "Ir a la línea",
        lineNumber: "Número de línea",
        move: "Ir",
        save: "Guardar",
        dontSave: "No guardar",
        cancel: "Cancelar",
      },
      statusBar: {
        lineColumn: (line, column) => `Lín ${line}, Col ${column}`,
        characters: (count) => `${count} caracteres`,
        encoding: "UTF-8",
        alwaysOnTop: "Top",
        shortcuts: "Atajos",
      },
      windowTitles: {
        main: "AlwaysMemo",
        settings: "Configuración de AlwaysMemo",
      },
      statuses: {
        disabledShortcutsMultiWindow: "Los atajos globales se desactivaron porque hay varias ventanas abiertas",
        failedOpenNewWindow: "No se pudo abrir una nueva ventana",
        opened: (title) => `Se abrió ${title}`,
        failedOpenFile: "No se pudo abrir el archivo",
        openingSaveDialog: "Abriendo el diálogo de guardado...",
        saveDialogReturnedNoPath: "No se seleccionó ninguna ubicación para guardar",
        savingTo: (path) => `Guardando en ${path}...`,
        saved: (title) => `Se guardó ${title}`,
        failedSaveFile: (error) => `No se pudo guardar el archivo: ${error}`,
        noSavedFilesToUpdate: "No hay archivos guardados para actualizar",
        savedAll: "Se guardaron todos los archivos",
        failedSaveAll: "No se pudieron guardar todos los archivos",
        alwaysOnTopEnabled: "Siempre visible activado",
        alwaysOnTopDisabled: "Siempre visible desactivado",
        failedSetAlwaysOnTop: "No se pudo actualizar el modo siempre visible",
        failedOpenSettingsWindow: "No se pudo abrir la ventana de configuración",
        failedOpenDetailedHelp: "No se pudo abrir la ayuda detallada",
        failedToggleAlwaysOnTop: "No se pudo cambiar el modo siempre visible",
        snappedLeft: "Ajustado arriba a la izquierda (atajo)",
        failedSnapLeft: "No se pudo ajustar a la izquierda",
        snappedRight: "Ajustado arriba a la derecha (atajo)",
        failedSnapRight: "No se pudo ajustar a la derecha",
        snappedTop: "Ajustado al borde superior (atajo)",
        failedSnapTop: "No se pudo ajustar al borde superior",
        snappedBottom: "Ajustado al borde inferior (atajo)",
        failedSnapBottom: "No se pudo ajustar al borde inferior",
        resizedMinimum: "Redimensionado al tamaño mínimo (atajo)",
        failedResizeMinimum: "No se pudo redimensionar al tamaño mínimo",
        resizedFitContent: "Redimensionado para ajustarse al contenido (atajo)",
        failedResizeFitContent: "No se pudo redimensionar para ajustarse al contenido",
        failedReadAlwaysOnTopState: "No se pudo leer el estado de siempre visible",
        clipboardUnavailable: "El acceso al portapapeles no está disponible",
        hotkeyToggleAlwaysOnTop: "Atajo: se cambió el modo siempre visible",
        hotkeySnapLeft: "Atajo: ajustado a la izquierda",
        hotkeySnapRight: "Atajo: ajustado a la derecha",
        hotkeySnapTop: "Atajo: ajustado al borde superior",
        hotkeySnapBottom: "Atajo: ajustado al borde inferior",
        globalShortcutError: (message) => `Error de atajo global: ${message}`,
        globalShortcutsActive: "Los atajos globales están activos",
        localShortcutsActive: "Los atajos locales están activos (ventana enfocada)",
        failedConfigureShortcuts: "No se pudieron configurar los atajos",
      },
    },
    settings: {
      loading: "Cargando configuración...",
      navigation: {
        language: "Idioma",
        appearance: "Apariencia",
        formatting: "Formato",
        features: "Funciones",
        startup: "Inicio",
        about: "Acerca de",
      },
      language: {
        title: "Idioma",
        description: "Elige el idioma que se usa en toda la app.",
        label: "Idioma de la interfaz",
        helper: "Elige Sistema para seguir el idioma de tu sistema operativo",
      },
      appearance: {
        title: "Apariencia",
        description: "Ajusta el aspecto de la ventana de memos.",
        themeLabel: "Tema",
        themeDescription: "Elige el tema de color de la app",
        themeLight: "Claro",
        themeDark: "Oscuro",
        themeSystem: "Sistema",
      },
      formatting: {
        title: "Formato",
        description: "Ajusta cómo se muestra y se organiza el texto.",
        fontSizeLabel: "Tamaño de fuente",
        fontSizeDescription: "Ajústalo para leer con más comodidad",
        lineSpacingLabel: "Espaciado entre líneas",
        lineSpacingDescription: "Controla el espacio entre líneas",
        lineSpacingStandard: "Estándar",
        lineSpacingRelaxed: "Amplio",
        wrapLabel: "Ajuste de texto",
        wrapDescription: "Ajusta automáticamente las líneas largas",
        previewTitle: "Vista previa:",
        previewLine1: "Este es un ejemplo de visualización de AlwaysMemo.",
        previewLine2: "Esta frase es un poco más larga a propósito para que puedas comprobar cómo se ve el ajuste de línea.",
      },
      features: {
        title: "Funciones",
        description: "Configura funciones que te ayudan a trabajar más rápido.",
        alwaysOnTopLabel: "Siempre visible",
        alwaysOnTopDescription: "Mantén la ventana por encima de otras apps",
        globalShortcutsLabel: "Atajos globales",
        globalShortcutsDescription: "Controla la app desde cualquier parte del sistema",
      },
      startup: {
        title: "Inicio",
        description: "Elige qué ocurre cuando la app se inicia.",
        sessionLabel: "Sesión",
        restoreSession: "Restaurar el estado anterior",
        startNewSession: "Empezar siempre desde cero",
        fileOpenLabel: "Apertura de archivos",
        openInExistingWindow: "Añadir a la ventana actual",
        openInNewWindow: "Abrir en una ventana nueva",
      },
      about: {
        description: "Una herramienta de memos que te permite capturar ideas al instante sin romper tu flujo.",
        version: (version) => `Versión ${version}`,
        settingsWindow: "Ventana de configuración",
        license: "Licencia MIT",
        linksLabel: "Enlaces de AlwaysMemo",
        help: "Ayuda",
        terms: "Términos",
        privacy: "Privacidad",
      },
    },
  },
  "pt-BR": {
    common: {
      productName: "AlwaysMemo",
      on: "ON",
      off: "OFF",
      windowControls: {
        minimize: "Minimizar",
        maximize: "Maximizar",
        restore: "Restaurar",
        close: "Fechar",
      },
      languageOptions: {
        system: "Sistema",
        ja: "Japonês",
        en: "Inglês",
        es: "Espanhol",
        "pt-BR": "Português (Brasil)",
        ko: "Coreano",
      },
    },
    app: {
      untitledTab: "Sem título",
      numberedMemo: (index) => `Memo ${index}`,
      defaultSaveName: "memo",
      textFileFilter: "Texto",
      renameTabPrompt: "Renomear aba",
      tabCloseAria: {
        unsaved: "Não salvo",
        close: "Fechar",
      },
      menu: {
        file: "Arquivo",
        edit: "Editar",
        view: "Exibir",
        newTab: "Nova aba",
        newWindow: "Nova janela",
        open: "Abrir",
        recentFiles: "Arquivos recentes",
        save: "Salvar",
        saveAs: "Salvar como",
        saveAll: "Salvar tudo",
        alwaysOnTop: "Sempre no topo",
        globalShortcuts: "Atalhos globais",
        closeTab: "Fechar aba",
        closeWindow: "Fechar janela",
        exit: "Sair",
        undo: "Desfazer",
        cut: "Recortar",
        copy: "Copiar",
        paste: "Colar",
        find: "Localizar",
        replace: "Substituir",
        goTo: "Ir para",
        font: "Fonte",
        zoomIn: "Ampliar",
        zoomOut: "Reduzir",
        resetZoom: "Redefinir zoom",
        statusBar: "Barra de status",
        wrapAtRightEdge: "Quebra automática de linha",
        zoomInShortcut: "Ctrl+Mais (+)",
        zoomOutShortcut: "Ctrl+Menos (-)",
      },
      search: {
        searchPlaceholder: "Buscar",
        replacePlaceholder: "Substituir",
        count: (count) => `${count} ocorrências`,
        close: "Fechar busca",
        replace: "Substituir",
        replaceAll: "Substituir tudo",
      },
      help: {
        buttonLabel: "Ajuda",
        hintLabel: "Dica de ajuda",
        closeHint: "Fechar dica",
        hintBody: "Abra dicas de atalhos e notas de recursos por aqui",
        panelLabel: "Ajuda rápida",
        title: "Ajuda",
        closePanel: "Fechar ajuda",
        shortcutsTitle: "Ações comuns",
        pointsTitle: "Por que AlwaysMemo",
        openDetailedHelp: "Abrir ajuda completa",
        shortcuts: [
          { keys: ["Ctrl", "Alt", "T"], label: "Alternar sempre no topo" },
          { groups: [["Ctrl", "Alt"], ["←", "↑", "→", "↓"]], label: "Mover a janela" },
          { keys: ["Ctrl", "N"], label: "Criar um novo memo" },
          { keys: ["Ctrl", "W"], label: "Excluir o memo atual" },
        ],
        points: [
          "Mantenha seu memo acima dos outros apps quando precisar",
          "Ative os atalhos globais para controlá-lo de qualquer lugar",
        ],
      },
      settingsButtonLabel: "Configurações",
      newTabButtonTitle: "Nova aba",
      editorPlaceholder: "Escreva seu memo aqui",
      onboarding: {
        skip: "Pular",
        next: "Próximo",
        finish: "Concluir",
        tested: "Atalho confirmado",
        steps: {
          snap: { title: "Mova a janela rapidamente", shortcutLabel: "Atalho para mover a janela", body: "Use uma seta para mover o AlwaysMemo rapidamente pela tela.", instruction: "Experimente o atalho agora." },
          alwaysOnTop: { title: "Mantenha o memo à frente", shortcutLabel: "Atalho sempre no topo", body: "Mantenha o AlwaysMemo visível enquanto usa outros aplicativos.", instruction: "Experimente o atalho agora." },
          fitContent: { title: "Ajuste a janela ao memo", shortcutLabel: "Atalho para ajustar conteúdo", body: "Redimensione rapidamente a janela para o conteúdo do memo.", instruction: "Experimente o atalho agora." },
          focus: { title: "Volte ao memo a qualquer momento", shortcutLabel: "Atalho para focar", body: "Abra o AlwaysMemo de outro aplicativo e digite imediatamente.", instruction: "Experimente o atalho agora." },
        },
      },
      reviewPrompt: {
        title: "O AlwaysMemo é útil para você?",
        body: "Sua avaliação e opinião nos ajudam a melhorar o AlwaysMemo.",
        later: "Mais tarde",
        review: "Avaliar",
        close: "Fechar pedido de avaliação",
      },
      dialogs: {
        confirmTitle: "Confirmar",
        unsavedMemosBeforeExit: (count) =>
          count > 1
            ? `Você tem ${count} memos não salvos. Deseja salvá-los antes de fechar?`
            : "Você tem um memo não salvo. Deseja salvá-lo antes de fechar?",
        saveChangesTo: (target) => `Salvar alterações em ${target}?`,
        goToLineTitle: "Ir para a linha",
        lineNumber: "Número da linha",
        move: "Ir",
        save: "Salvar",
        dontSave: "Não salvar",
        cancel: "Cancelar",
      },
      statusBar: {
        lineColumn: (line, column) => `Lin ${line}, Col ${column}`,
        characters: (count) => `${count} caracteres`,
        encoding: "UTF-8",
        alwaysOnTop: "Topo",
        shortcuts: "Atalhos",
      },
      windowTitles: {
        main: "AlwaysMemo",
        settings: "Configurações do AlwaysMemo",
      },
      statuses: {
        disabledShortcutsMultiWindow: "Os atalhos globais foram desativados porque há várias janelas abertas",
        failedOpenNewWindow: "Não foi possível abrir uma nova janela",
        opened: (title) => `${title} foi aberto`,
        failedOpenFile: "Não foi possível abrir o arquivo",
        openingSaveDialog: "Abrindo a caixa de diálogo de salvamento...",
        saveDialogReturnedNoPath: "Nenhum local de salvamento foi selecionado",
        savingTo: (path) => `Salvando em ${path}...`,
        saved: (title) => `${title} foi salvo`,
        failedSaveFile: (error) => `Não foi possível salvar o arquivo: ${error}`,
        noSavedFilesToUpdate: "Não há arquivos salvos para atualizar",
        savedAll: "Todos os arquivos foram salvos",
        failedSaveAll: "Não foi possível salvar todos os arquivos",
        alwaysOnTopEnabled: "Sempre no topo ativado",
        alwaysOnTopDisabled: "Sempre no topo desativado",
        failedSetAlwaysOnTop: "Não foi possível atualizar o modo sempre no topo",
        failedOpenSettingsWindow: "Não foi possível abrir a janela de configurações",
        failedOpenDetailedHelp: "Não foi possível abrir a ajuda detalhada",
        failedToggleAlwaysOnTop: "Não foi possível alternar o modo sempre no topo",
        snappedLeft: "Ajustado para o canto superior esquerdo (atalho)",
        failedSnapLeft: "Não foi possível ajustar à esquerda",
        snappedRight: "Ajustado para o canto superior direito (atalho)",
        failedSnapRight: "Não foi possível ajustar à direita",
        snappedTop: "Ajustado à borda superior (atalho)",
        failedSnapTop: "Não foi possível ajustar à borda superior",
        snappedBottom: "Ajustado à borda inferior (atalho)",
        failedSnapBottom: "Não foi possível ajustar à borda inferior",
        resizedMinimum: "Redimensionado para o tamanho mínimo (atalho)",
        failedResizeMinimum: "Não foi possível redimensionar para o tamanho mínimo",
        resizedFitContent: "Redimensionado para caber no conteúdo (atalho)",
        failedResizeFitContent: "Não foi possível redimensionar para caber no conteúdo",
        failedReadAlwaysOnTopState: "Não foi possível ler o estado de sempre no topo",
        clipboardUnavailable: "O acesso à área de transferência não está disponível",
        hotkeyToggleAlwaysOnTop: "Atalho: sempre no topo alternado",
        hotkeySnapLeft: "Atalho: ajustado à esquerda",
        hotkeySnapRight: "Atalho: ajustado à direita",
        hotkeySnapTop: "Atalho: ajustado à borda superior",
        hotkeySnapBottom: "Atalho: ajustado à borda inferior",
        globalShortcutError: (message) => `Erro de atalho global: ${message}`,
        globalShortcutsActive: "Os atalhos globais estão ativos",
        localShortcutsActive: "Os atalhos locais estão ativos (janela em foco)",
        failedConfigureShortcuts: "Não foi possível configurar os atalhos",
      },
    },
    settings: {
      loading: "Carregando configurações...",
      navigation: {
        language: "Idioma",
        appearance: "Aparência",
        formatting: "Formatação",
        features: "Recursos",
        startup: "Inicialização",
        about: "Sobre",
      },
      language: {
        title: "Idioma",
        description: "Escolha o idioma usado em todo o app.",
        label: "Idioma de exibição",
        helper: "Escolha Sistema para seguir o idioma do seu sistema operacional",
      },
      appearance: {
        title: "Aparência",
        description: "Ajuste a aparência da janela de memos.",
        themeLabel: "Tema",
        themeDescription: "Escolha o tema de cores do app",
        themeLight: "Claro",
        themeDark: "Escuro",
        themeSystem: "Sistema",
      },
      formatting: {
        title: "Formatação",
        description: "Ajuste como o texto é exibido e organizado.",
        fontSizeLabel: "Tamanho da fonte",
        fontSizeDescription: "Ajuste para uma leitura mais confortável",
        lineSpacingLabel: "Espaçamento entre linhas",
        lineSpacingDescription: "Controle o espaço entre as linhas",
        lineSpacingStandard: "Padrão",
        lineSpacingRelaxed: "Amplo",
        wrapLabel: "Quebra de texto",
        wrapDescription: "Quebre automaticamente linhas longas",
        previewTitle: "Pré-visualização:",
        previewLine1: "Este é um exemplo de exibição do AlwaysMemo.",
        previewLine2: "Esta frase é um pouco mais longa de propósito para você verificar como a quebra de linha fica.",
      },
      features: {
        title: "Recursos",
        description: "Configure recursos que ajudam você a trabalhar mais rápido.",
        alwaysOnTopLabel: "Sempre no topo",
        alwaysOnTopDescription: "Mantenha a janela acima dos outros apps",
        globalShortcutsLabel: "Atalhos globais",
        globalShortcutsDescription: "Controle o app de qualquer lugar do sistema",
      },
      startup: {
        title: "Inicialização",
        description: "Escolha o que acontece quando o app inicia.",
        sessionLabel: "Sessão",
        restoreSession: "Restaurar o estado anterior",
        startNewSession: "Sempre começar do zero",
        fileOpenLabel: "Abertura de arquivos",
        openInExistingWindow: "Adicionar à janela atual",
        openInNewWindow: "Abrir em uma nova janela",
      },
      about: {
        description: "Uma ferramenta de memos para capturar ideias na hora sem quebrar seu fluxo.",
        version: (version) => `Versão ${version}`,
        settingsWindow: "Janela de configurações",
        license: "Licença MIT",
        linksLabel: "Links do AlwaysMemo",
        help: "Ajuda",
        terms: "Termos",
        privacy: "Privacidade",
      },
    },
  },
  ko: {
    common: {
      productName: "AlwaysMemo",
      on: "ON",
      off: "OFF",
      windowControls: {
        minimize: "최소화",
        maximize: "최대화",
        restore: "복원",
        close: "닫기",
      },
      languageOptions: {
        system: "시스템",
        ja: "일본어",
        en: "영어",
        es: "스페인어",
        "pt-BR": "포르투갈어(브라질)",
        ko: "한국어",
      },
    },
    app: {
      untitledTab: "제목 없음",
      numberedMemo: (index) => `메모 ${index}`,
      defaultSaveName: "memo",
      textFileFilter: "텍스트",
      renameTabPrompt: "탭 이름 바꾸기",
      tabCloseAria: {
        unsaved: "저장되지 않음",
        close: "닫기",
      },
      menu: {
        file: "파일",
        edit: "편집",
        view: "보기",
        newTab: "새 탭",
        newWindow: "새 창",
        open: "열기",
        recentFiles: "최근 파일",
        save: "저장",
        saveAs: "다른 이름으로 저장",
        saveAll: "모두 저장",
        alwaysOnTop: "항상 위에 표시",
        globalShortcuts: "전역 단축키",
        closeTab: "탭 닫기",
        closeWindow: "창 닫기",
        exit: "종료",
        undo: "실행 취소",
        cut: "잘라내기",
        copy: "복사",
        paste: "붙여넣기",
        find: "찾기",
        replace: "바꾸기",
        goTo: "이동",
        font: "글꼴",
        zoomIn: "확대",
        zoomOut: "축소",
        resetZoom: "확대/축소 초기화",
        statusBar: "상태 표시줄",
        wrapAtRightEdge: "자동 줄 바꿈",
        zoomInShortcut: "Ctrl+더하기(+)",
        zoomOutShortcut: "Ctrl+빼기(-)",
      },
      search: {
        searchPlaceholder: "검색",
        replacePlaceholder: "바꾸기",
        count: (count) => `${count}개 일치`,
        close: "검색 닫기",
        replace: "바꾸기",
        replaceAll: "모두 바꾸기",
      },
      help: {
        buttonLabel: "도움말",
        hintLabel: "도움말 팁",
        closeHint: "팁 닫기",
        hintBody: "여기에서 단축키 팁과 기능 안내를 확인할 수 있습니다",
        panelLabel: "빠른 도움말",
        title: "도움말",
        closePanel: "도움말 닫기",
        shortcutsTitle: "자주 쓰는 작업",
        pointsTitle: "AlwaysMemo의 장점",
        openDetailedHelp: "자세한 도움말 열기",
        shortcuts: [
          { keys: ["Ctrl", "Alt", "T"], label: "항상 위에 표시 전환" },
          { groups: [["Ctrl", "Alt"], ["←", "↑", "→", "↓"]], label: "창 이동" },
          { keys: ["Ctrl", "N"], label: "새 메모 만들기" },
          { keys: ["Ctrl", "W"], label: "현재 메모 삭제" },
        ],
        points: [
          "필요할 때 메모 창을 다른 앱 위에 둘 수 있습니다",
          "전역 단축키를 켜면 어디서든 빠르게 조작할 수 있습니다",
        ],
      },
      settingsButtonLabel: "설정",
      newTabButtonTitle: "새 탭",
      editorPlaceholder: "여기에 메모를 입력하세요",
      onboarding: {
        skip: "건너뛰기",
        next: "다음",
        finish: "완료",
        tested: "단축키를 확인했습니다",
        steps: {
          snap: { title: "창을 빠르게 이동", shortcutLabel: "창 이동 단축키", body: "화살표 키로 AlwaysMemo를 화면의 원하는 위치로 빠르게 이동합니다.", instruction: "지금 단축키를 눌러 보세요." },
          alwaysOnTop: { title: "메모를 항상 위에 표시", shortcutLabel: "항상 위에 표시 단축키", body: "다른 앱을 사용하는 동안에도 AlwaysMemo를 앞에 표시합니다.", instruction: "지금 단축키를 눌러 보세요." },
          fitContent: { title: "메모에 맞게 창 크기 조절", shortcutLabel: "내용 맞춤 단축키", body: "메모 내용에 맞게 창 크기를 빠르게 조절합니다.", instruction: "지금 단축키를 눌러 보세요." },
          focus: { title: "언제든 메모로 돌아오기", shortcutLabel: "포커스 단축키", body: "다른 앱에서 AlwaysMemo를 불러와 바로 입력할 수 있습니다.", instruction: "지금 단축키를 눌러 보세요." },
        },
      },
      reviewPrompt: {
        title: "AlwaysMemo가 도움이 되고 있나요?",
        body: "평가와 의견을 남겨 주시면 AlwaysMemo를 개선하는 데 도움이 됩니다.",
        later: "나중에",
        review: "평가하기",
        close: "리뷰 요청 닫기",
      },
      dialogs: {
        confirmTitle: "확인",
        unsavedMemosBeforeExit: (count) =>
          count > 1
            ? `저장되지 않은 메모가 ${count}개 있습니다. 닫기 전에 저장할까요?`
            : "저장되지 않은 메모가 있습니다. 닫기 전에 저장할까요?",
        saveChangesTo: (target) => `${target}의 변경 내용을 저장할까요?`,
        goToLineTitle: "줄로 이동",
        lineNumber: "줄 번호",
        move: "이동",
        save: "저장",
        dontSave: "저장하지 않음",
        cancel: "취소",
      },
      statusBar: {
        lineColumn: (line, column) => `줄 ${line}, 칸 ${column}`,
        characters: (count) => `${count}자`,
        encoding: "UTF-8",
        alwaysOnTop: "위에 표시",
        shortcuts: "단축키",
      },
      windowTitles: {
        main: "AlwaysMemo",
        settings: "AlwaysMemo 설정",
      },
      statuses: {
        disabledShortcutsMultiWindow: "여러 창이 열려 있어 전역 단축키를 껐습니다",
        failedOpenNewWindow: "새 창을 열지 못했습니다",
        opened: (title) => `${title}을(를) 열었습니다`,
        failedOpenFile: "파일을 열지 못했습니다",
        openingSaveDialog: "저장 대화 상자를 여는 중...",
        saveDialogReturnedNoPath: "저장 위치가 선택되지 않았습니다",
        savingTo: (path) => `${path}에 저장하는 중...`,
        saved: (title) => `${title}을(를) 저장했습니다`,
        failedSaveFile: (error) => `파일 저장에 실패했습니다: ${error}`,
        noSavedFilesToUpdate: "업데이트할 저장된 파일이 없습니다",
        savedAll: "모든 파일을 저장했습니다",
        failedSaveAll: "모든 파일을 저장하지 못했습니다",
        alwaysOnTopEnabled: "항상 위에 표시를 켰습니다",
        alwaysOnTopDisabled: "항상 위에 표시를 껐습니다",
        failedSetAlwaysOnTop: "항상 위에 표시 설정을 변경하지 못했습니다",
        failedOpenSettingsWindow: "설정 창을 열지 못했습니다",
        failedOpenDetailedHelp: "자세한 도움말을 열지 못했습니다",
        failedToggleAlwaysOnTop: "항상 위에 표시를 전환하지 못했습니다",
        snappedLeft: "왼쪽 위로 이동했습니다(단축키)",
        failedSnapLeft: "왼쪽으로 이동하지 못했습니다",
        snappedRight: "오른쪽 위로 이동했습니다(단축키)",
        failedSnapRight: "오른쪽으로 이동하지 못했습니다",
        snappedTop: "위쪽 가장자리로 이동했습니다(단축키)",
        failedSnapTop: "위쪽 가장자리로 이동하지 못했습니다",
        snappedBottom: "아래쪽 가장자리로 이동했습니다(단축키)",
        failedSnapBottom: "아래쪽 가장자리로 이동하지 못했습니다",
        resizedMinimum: "최소 크기로 변경했습니다(단축키)",
        failedResizeMinimum: "최소 크기로 변경하지 못했습니다",
        resizedFitContent: "내용에 맞게 크기를 변경했습니다(단축키)",
        failedResizeFitContent: "내용에 맞게 크기를 변경하지 못했습니다",
        failedReadAlwaysOnTopState: "항상 위에 표시 상태를 읽지 못했습니다",
        clipboardUnavailable: "클립보드에 접근할 수 없습니다",
        hotkeyToggleAlwaysOnTop: "단축키: 항상 위에 표시를 전환했습니다",
        hotkeySnapLeft: "단축키: 왼쪽으로 이동했습니다",
        hotkeySnapRight: "단축키: 오른쪽으로 이동했습니다",
        hotkeySnapTop: "단축키: 위쪽 가장자리로 이동했습니다",
        hotkeySnapBottom: "단축키: 아래쪽 가장자리로 이동했습니다",
        globalShortcutError: (message) => `전역 단축키 오류: ${message}`,
        globalShortcutsActive: "전역 단축키가 활성화되었습니다",
        localShortcutsActive: "로컬 단축키가 활성화되었습니다(창 포커스 중)",
        failedConfigureShortcuts: "단축키를 설정하지 못했습니다",
      },
    },
    settings: {
      loading: "설정을 불러오는 중...",
      navigation: {
        language: "언어",
        appearance: "모양",
        formatting: "서식",
        features: "기능",
        startup: "시작",
        about: "정보",
      },
      language: {
        title: "언어",
        description: "앱 전체에서 사용할 언어를 선택합니다.",
        label: "표시 언어",
        helper: "시스템을 선택하면 OS 표시 언어를 따릅니다",
      },
      appearance: {
        title: "모양",
        description: "메모 창의 표시 방식을 조정합니다.",
        themeLabel: "테마",
        themeDescription: "앱의 색상 테마를 선택합니다",
        themeLight: "라이트",
        themeDark: "다크",
        themeSystem: "시스템",
      },
      formatting: {
        title: "서식",
        description: "텍스트 표시와 구성을 조정합니다.",
        fontSizeLabel: "글꼴 크기",
        fontSizeDescription: "읽기 편한 크기로 조정합니다",
        lineSpacingLabel: "줄 간격",
        lineSpacingDescription: "줄 사이 간격을 조정합니다",
        lineSpacingStandard: "표준",
        lineSpacingRelaxed: "넓게",
        wrapLabel: "줄 바꿈",
        wrapDescription: "긴 줄을 자동으로 줄 바꿈합니다",
        previewTitle: "미리 보기:",
        previewLine1: "AlwaysMemo 표시 예시입니다.",
        previewLine2: "이 문장은 줄 바꿈 설정을 확인할 수 있도록 일부러 조금 길게 작성했습니다.",
      },
      features: {
        title: "기능",
        description: "작업을 더 빠르게 도와주는 기능을 설정합니다.",
        alwaysOnTopLabel: "항상 위에 표시",
        alwaysOnTopDescription: "창을 다른 앱 위에 유지합니다",
        globalShortcutsLabel: "전역 단축키",
        globalShortcutsDescription: "시스템 어디서든 앱을 조작합니다",
      },
      startup: {
        title: "시작",
        description: "앱이 시작될 때의 동작을 선택합니다.",
        sessionLabel: "세션",
        restoreSession: "이전 상태 복원",
        startNewSession: "항상 새로 시작",
        fileOpenLabel: "파일 열기",
        openInExistingWindow: "현재 창에 추가",
        openInNewWindow: "새 창에서 열기",
      },
      about: {
        description: "흐름을 끊지 않고 아이디어를 바로 적을 수 있는 메모 도구입니다.",
        version: (version) => `버전 ${version}`,
        settingsWindow: "설정 창",
        license: "MIT 라이선스",
        linksLabel: "AlwaysMemo 관련 링크",
        help: "도움말",
        terms: "이용 약관",
        privacy: "개인정보 처리방침",
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
    if (normalized.startsWith("es")) return "es";
    if (normalized.startsWith("pt")) return "pt-BR";
    if (normalized.startsWith("ko")) return "ko";
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
