import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { openUrl } from "@tauri-apps/plugin-opener";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  getCurrentWindow,
  LogicalSize,
  UserAttentionType,
} from "@tauri-apps/api/window";
import {
  CircleQuestionMark,
  Copy,
  ExternalLink,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Square,
  X,
} from "lucide-react";
import {
  FILE_PATH_PATTERN,
  ensureTextFileExtension,
  escapeRegex,
  htmlToText,
  normalizePlainText,
  normalizeHtml,
  nodeToPlainTextBeforePosition,
  replaceTextInHtml,
  stripTrustedSearchHighlights,
  textToHtml,
  trustedHtmlToText,
} from "./lib/editorContent";
import {
  SETTINGS_REQUEST_EVENT,
  SETTINGS_SYNC_EVENT,
  SETTINGS_UPDATE_EVENT,
  createSettingsWindowLabel,
  isSettingsWindowLabel,
  type SettingsPatch,
  type SettingsRequestPayload,
  type SettingsSnapshot as BridgeSettingsSnapshot,
} from "./lib/settingsBridge";
import {
  isUntitledTitle,
  useMessages,
  type LanguagePreference,
} from "./lib/i18n";
import "./App.css";

const MIN_WINDOW_WIDTH = 300;
const MIN_WINDOW_HEIGHT = 200;
const STATE_PERSIST_DEBOUNCE_MS = 300;
const STORAGE_KEY = "alwaysmemo-state";
const GLOBAL_SHORTCUT_SYNC_KEY = "alwaysmemo-global-shortcut-sync";
const PENDING_OPEN_FILES_EVENT = "alwaysmemo:pending-open-files";
const TAB_CLOSE_ANIMATION_MS = 140;
const HELP_URL = "https://alwaysmemo.pages.dev/help";
const HELP_HINT_STORAGE_KEY = "alwaysmemo-help-hint-seen";
const DEFAULT_USE_GLOBAL_SHORTCUTS = true;

type Tab = {
  id: string;
  title: string;
  content: string;
  filePath?: string | null;
};

type SnapPosition = "left" | "right" | "top" | "bottom" | null;
type SessionBehavior = "restore" | "new";
type FileOpenBehavior = "existing" | "new_window";
type LineSpacing = "standard" | "relaxed";
type ThemeMode = "light" | "dark" | "system";

type PersistedState = {
  tabs: Tab[];
  activeTabId: string | null;
  alwaysOnTop: boolean;
  snap: SnapPosition;
  useGlobalShortcuts: boolean;
  showStatusBar?: boolean;
  wrapAtRightEdge?: boolean;
  sessionBehavior?: SessionBehavior;
  fileOpenBehavior?: FileOpenBehavior;
  editorFontSizePx?: number;
  lineSpacing?: LineSpacing;
  themeMode?: ThemeMode;
  languagePreference?: LanguagePreference;
};

type GlobalShortcutSyncMessage = {
  enabled: boolean;
  reason: "manual" | "auto-multi-window";
  ts: number;
};

type RecentClosedFile = {
  path: string;
  title: string;
  closedAt: number;
};
const MAX_RECENT_CLOSED_FILES = 7;

type OpenedTextFile = {
  path: string;
  contents: string;
};

function App() {
  const [useGlobalShortcuts, setUseGlobalShortcuts] = useState(DEFAULT_USE_GLOBAL_SHORTCUTS);
  const [alwaysOnTop, setAlwaysOnTopState] = useState(false);
  const [, setStatus] = useState<string | null>(null);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>("system");
  const { messages } = useMessages(languagePreference);
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "initial", title: messages.app.untitledTab, content: "" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("initial");
  const [snap, setSnap] = useState<SnapPosition>(null);
  const toggleLockRef = useRef(0);
  const tabsScrollerRef = useRef<HTMLDivElement | null>(null);
  const topTitlebarRef = useRef<HTMLDivElement | null>(null);
  const activeTabIdRef = useRef<string>("initial");
  const tabHistoryRef = useRef<string[]>([]);
  const persistStateTimerRef = useRef<number | null>(null);
  const pendingRevealTabIdRef = useRef<string | null>(null);
  const tabsWheelTargetRef = useRef<number | null>(null);
  const tabsWheelRafRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
  const allowImmediateCloseRef = useRef(false);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const cursorUpdateRafRef = useRef<number | null>(null);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const savedTabsRef = useRef<Record<string, { title: string; content: string }>>({});
  const [, setSavedVersion] = useState(0);
  const [openMenu, setOpenMenu] = useState<"file" | "edit" | "view" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const helpHintRef = useRef<HTMLDivElement | null>(null);
  const helpPanelRef = useRef<HTMLDivElement | null>(null);
  const [helpPanelOpen, setHelpPanelOpen] = useState(false);
  const [helpHintVisible, setHelpHintVisible] = useState(false);
  const fileMenuWrapperRef = useRef<HTMLDivElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const [fileMenuStyle, setFileMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const editMenuRef = useRef<HTMLDivElement | null>(null);
  const editMenuWrapperRef = useRef<HTMLDivElement | null>(null);
  const [editMenuStyle, setEditMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const viewMenuWrapperRef = useRef<HTMLDivElement | null>(null);
  const [viewMenuStyle, setViewMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [wrapAtRightEdge, setWrapAtRightEdge] = useState(true);
  const [editorFontSizePx, setEditorFontSizePx] = useState(14);
  const [, setEditorFontSizeInput] = useState("14");
  const [lineSpacing, setLineSpacing] = useState<LineSpacing>("standard");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [sessionBehavior, setSessionBehavior] = useState<SessionBehavior>("restore");
  const [fileOpenBehavior, setFileOpenBehavior] = useState<FileOpenBehavior>("existing");
  const [deletePromptTabId, setDeletePromptTabId] = useState<string | null>(null);
  const [windowClosePromptOpen, setWindowClosePromptOpen] = useState(false);
  const [closingTabIds, setClosingTabIds] = useState<string[]>([]);
  const [hoveredTabCloseId, setHoveredTabCloseId] = useState<string | null>(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const tabCloseTimerRef = useRef<Record<string, number>>({});
  const windowStateSyncTimerRef = useRef<number | null>(null);
  const settingsSnapshotRef = useRef<BridgeSettingsSnapshot>({
    alwaysOnTop: false,
    useGlobalShortcuts: DEFAULT_USE_GLOBAL_SHORTCUTS,
    showStatusBar: true,
    wrapAtRightEdge: true,
    editorFontSizePx: 14,
    lineSpacing: "standard",
    themeMode: "system",
    sessionBehavior: "restore",
    fileOpenBehavior: "existing",
    languagePreference: "system",
  });
  const settingsReadyRef = useRef(false);
  const [startupStateReady, setStartupStateReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [showSearchBox, setShowSearchBox] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [goToLineOpen, setGoToLineOpen] = useState(false);
  const [goToLineValue, setGoToLineValue] = useState("1");
  const goToLineInputRef = useRef<HTMLInputElement | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [, setRecentClosedFiles] = useState<RecentClosedFile[]>([]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const deletePromptTab =
    deletePromptTabId ? tabs.find((tab) => tab.id === deletePromptTabId) ?? null : null;
  const windowHandle = getCurrentWindow();
  const currentWebviewWindow = useMemo(() => WebviewWindow.getCurrent(), []);
  const currentWindowLabel = currentWebviewWindow.label;
  const settingsWindowLabel = useMemo(
    () => createSettingsWindowLabel(currentWindowLabel),
    [currentWindowLabel],
  );
  const effectiveTheme = useMemo(
    () => (themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode),
    [systemPrefersDark, themeMode],
  );
  const syncWindowMaximizedState = useCallback(async () => {
    try {
      const maximized = await windowHandle.isMaximized();
      setIsWindowMaximized(maximized);
      return maximized;
    } catch (error) {
      console.error("Failed to sync maximized state", error);
      return null;
    }
  }, [windowHandle]);

  const scheduleWindowMaximizedSync = useCallback((delay = 120) => {
    if (windowStateSyncTimerRef.current !== null) {
      window.clearTimeout(windowStateSyncTimerRef.current);
    }
    windowStateSyncTimerRef.current = window.setTimeout(() => {
      windowStateSyncTimerRef.current = null;
      void syncWindowMaximizedState();
    }, delay);
  }, [syncWindowMaximizedState]);

  useEffect(() => {
    setEditorFontSizeInput(String(editorFontSizePx));
  }, [editorFontSizePx]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
    if (!activeTabId) return;
    tabHistoryRef.current = [...tabHistoryRef.current.filter((id) => id !== activeTabId), activeTabId].slice(-100);
  }, [activeTabId]);
  const activeHtml = activeTab?.content ?? "";
  const activePlainText = useMemo(() => trustedHtmlToText(activeHtml), [activeHtml]);
  const storageKey = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const instance = params.get("instance");
    return instance ? `${STORAGE_KEY}-${instance}` : STORAGE_KEY;
  }, []);
  const recentClosedKey = useMemo(() => `${storageKey}-recent-closed`, [storageKey]);
  const zoomPercentLabel = useMemo(() => `${Math.round(zoomLevel * 100)}%`, [zoomLevel]);
  const editorLineHeight = useMemo(
    () => (lineSpacing === "relaxed" ? 1.75 : 1.15),
    [lineSpacing],
  );
  const editorBlockGapPx = useMemo(
    () => (lineSpacing === "relaxed" ? 6 : 2),
    [lineSpacing],
  );

  const applyEditorHtml = useCallback((editor: HTMLDivElement, html: string) => {
    if (editor.innerHTML !== html) {
      editor.innerHTML = html;
    }
  }, []);

  const updateCursorIndex = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      setCursorPosition({ line: 1, column: 1 });
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) {
      setCursorPosition({ line: 1, column: 1 });
      return;
    }
    const normalized = normalizePlainText(
      nodeToPlainTextBeforePosition(editor, range.startContainer, range.startOffset),
    );
    const lines = normalized.split("\n");
    const currentLine = Math.max(lines.length, 1);
    const currentLineText = lines[lines.length - 1] ?? "";
    setCursorPosition({
      line: currentLine,
      column: Math.max(1, Array.from(currentLineText).length + 1),
    });
  }, []);

  const scheduleCursorIndexUpdate = useCallback(() => {
    if (cursorUpdateRafRef.current !== null) {
      window.cancelAnimationFrame(cursorUpdateRafRef.current);
    }
    cursorUpdateRafRef.current = window.requestAnimationFrame(() => {
      cursorUpdateRafRef.current = null;
      updateCursorIndex();
    });
  }, [updateCursorIndex]);

  const saveEditorSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return;
    savedSelectionRef.current = range.cloneRange();
  }, []);

  const restoreEditorSelection = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const saved = savedSelectionRef.current;
    if (!editor || !selection) return;
    editor.focus();
    if (!saved) return;
    try {
      selection.removeAllRanges();
      selection.addRange(saved);
    } catch {
      // Ignore stale range; keep editor focused and let command apply at caret.
    }
  }, []);

  const persistState = useCallback(
    (nextTabs: Tab[], nextActiveId = activeTabId) => {
      const state: PersistedState = {
        tabs: nextTabs,
        activeTabId: nextActiveId,
        alwaysOnTop,
        snap,
        useGlobalShortcuts,
        showStatusBar,
        wrapAtRightEdge,
        sessionBehavior,
        fileOpenBehavior,
        editorFontSizePx,
        lineSpacing,
        themeMode,
        languagePreference,
      };
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    },
    [
      activeTabId,
      alwaysOnTop,
      editorFontSizePx,
      fileOpenBehavior,
      languagePreference,
      lineSpacing,
      sessionBehavior,
      showStatusBar,
      snap,
      storageKey,
      themeMode,
      useGlobalShortcuts,
      wrapAtRightEdge,
    ],
  );

  const setGlobalShortcutsPreference = useCallback(
    (
      enabled: boolean,
      reason: "manual" | "auto-multi-window",
      options?: { broadcast?: boolean },
    ) => {
      setUseGlobalShortcuts(enabled);
      if (reason === "auto-multi-window" && !enabled) {
        setStatus(messages.app.statuses.disabledShortcutsMultiWindow);
      }
      if (options?.broadcast === false) return;
      try {
        const payload: GlobalShortcutSyncMessage = {
          enabled,
          reason,
          ts: Date.now(),
        };
        window.localStorage.setItem(GLOBAL_SHORTCUT_SYNC_KEY, JSON.stringify(payload));
      } catch {
        // Ignore storage sync failures; local state already changed.
      }
    },
    [messages.app.statuses.disabledShortcutsMultiWindow],
  );

  const revealAuxWindow = useCallback(async (target: WebviewWindow) => {
    try {
      if (await target.isMinimized()) {
        await target.unminimize();
      }
    } catch (error) {
      console.error("Failed to unminimize auxiliary window", error);
    }

    try {
      await target.show();
      await target.setFocus();
      await target.requestUserAttention(UserAttentionType.Informational);
    } catch (error) {
      console.error("Failed to reveal auxiliary window", error);
    }
  }, []);

  const ensureGlobalShortcutsSingleWindow = useCallback(async () => {
    try {
      const openWindows = await WebviewWindow.getAll();
      const editorWindows = openWindows.filter((windowRef) => !isSettingsWindowLabel(windowRef.label));
      if (editorWindows.length > 1) {
        if (useGlobalShortcuts) {
          setGlobalShortcutsPreference(false, "auto-multi-window");
        }
        return false;
      }
      return true;
    } catch (error) {
      console.error("Failed to inspect open windows", error);
      return true;
    }
  }, [setGlobalShortcutsPreference, useGlobalShortcuts]);

  const closeMenus = useCallback(() => {
    setOpenMenu(null);
    setHelpPanelOpen(false);
  }, []);

  const dismissHelpHint = useCallback(() => {
    setHelpHintVisible(false);
    try {
      window.localStorage.setItem(HELP_HINT_STORAGE_KEY, "1");
    } catch {
      // Ignore storage failures; hiding the hint for this session is enough.
    }
  }, []);

  const pickSavePath = useCallback(async (suggested: string) => {
    const withExt = ensureTextFileExtension(suggested);
    const defaultPath = withExt;
    let resolvedPath: string | null = null;
    let dialogFailed = false;
    const filters = [{ name: messages.app.textFileFilter, extensions: ["txt", "md", "markdown"] }];
    try {
      const picked = await save({
        defaultPath,
        filters,
      });
      resolvedPath =
        typeof picked === "string"
          ? picked
          : Array.isArray(picked)
            ? picked[0]
            : null;
    } catch (error) {
      console.error("dialog plugin save failed", error);
      dialogFailed = true;
    }
    if (!resolvedPath && dialogFailed) {
      resolvedPath = await invoke<string | null>("save_text_file_dialog", {
        default_name: defaultPath,
      });
    }
    if (!resolvedPath) return null;
    return ensureTextFileExtension(resolvedPath);
  }, [messages.app.textFileFilter]);

  const pathsKey = useMemo(() => `${storageKey}-paths`, [storageKey]);
  const getPathMap = useCallback((): Record<string, string> => {
    try {
      const raw = window.localStorage.getItem(pathsKey);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }, [pathsKey]);

  const setPathMap = useCallback(
    (next: Record<string, string>) => {
      window.localStorage.setItem(pathsKey, JSON.stringify(next));
    },
    [pathsKey],
  );

  const getFileNameFromPath = (path: string) => {
    const normalized = path.replace(/\\/g, "/");
    return normalized.split("/").pop() || path;
  };

  const appendOpenedFileTab = useCallback(
    (opened: OpenedTextFile, options?: { announce?: boolean }) => {
      const id = crypto.randomUUID();
      const title = getFileNameFromPath(opened.path) || messages.app.untitledTab;
      const content = textToHtml(opened.contents);
      const pathMap = getPathMap();
      setPathMap({ ...pathMap, [id]: opened.path });
      savedTabsRef.current = {
        ...savedTabsRef.current,
        [id]: { title, content },
      };
      setSavedVersion((prev) => prev + 1);
      setTabs((prev) => {
        const next = [...prev, { id, title, content, filePath: opened.path }];
        persistState(next, id);
        return next;
      });
      setActiveTabId(id);
      if (options?.announce !== false) {
        setStatus(messages.app.statuses.opened(title));
      }
    },
    [
      getFileNameFromPath,
      getPathMap,
      messages.app.statuses,
      messages.app.untitledTab,
      persistState,
      setPathMap,
      textToHtml,
    ],
  );

  const openFilesByPaths = useCallback(
    async (paths: string[], options?: { announce?: boolean }) => {
      if (paths.length === 0) return;
      for (const path of paths) {
        const opened = await invoke<OpenedTextFile | null>("open_text_file_by_path", {
          path,
        });
        if (!opened) {
          continue;
        }
        appendOpenedFileTab(opened, options);
      }
    },
    [appendOpenedFileTab],
  );

  const drainPendingOpenFiles = useCallback(
    async (options?: { announce?: boolean }) => {
      const paths = await invoke<string[]>("take_pending_open_files");
      if (paths.length === 0) return;
      await openFilesByPaths(paths, options);
    },
    [openFilesByPaths],
  );

  const isRecentEligiblePath = useCallback((path?: string | null) => {
    if (!path) return false;
    return FILE_PATH_PATTERN.test(path);
  }, []);

  const pushRecentClosedFile = useCallback((tab: Tab) => {
    if (!isRecentEligiblePath(tab.filePath)) return;
    const path = tab.filePath as string;
    const nextEntry: RecentClosedFile = {
      path,
      title: getFileNameFromPath(path),
      closedAt: Date.now(),
    };
    setRecentClosedFiles((prev) => {
      const deduped = prev.filter((item) => item.path !== path);
      const next = [nextEntry, ...deduped].slice(0, MAX_RECENT_CLOSED_FILES);
      window.localStorage.setItem(recentClosedKey, JSON.stringify(next));
      return next;
    });
  }, [getFileNameFromPath, isRecentEligiblePath, recentClosedKey]);

  const openFilePicker = useCallback(async () => {
    try {
      const opened = await invoke<OpenedTextFile | null>(
        "open_text_file_dialog",
      );
      if (!opened) return;
      if (fileOpenBehavior === "new_window") {
        const label = `alwaysmemo-${crypto.randomUUID()}`;
        const size = await windowHandle.outerSize();
        const alwaysOnTopParam = alwaysOnTop ? "1" : "0";
        const openPathParam = encodeURIComponent(opened.path);
        const newWindow = new WebviewWindow(label, {
          url: `/?instance=${label}&alwaysOnTop=${alwaysOnTopParam}&openPath=${openPathParam}`,
          width: size.width,
          height: size.height,
          decorations: false,
          resizable: true,
          title: messages.app.windowTitles.main,
        });
        newWindow.once("tauri://created", async () => {
          try {
            await newWindow.show();
            await newWindow.setFocus();
            if (alwaysOnTop) {
              await newWindow.setAlwaysOnTop(true);
            }
          } catch (error) {
            console.error("Failed to focus new window", error);
          }
        });
        newWindow.once("tauri://error", (error) => {
          console.error("Failed to create new window", error);
          setStatus(messages.app.statuses.failedOpenNewWindow);
        });
        closeMenus();
        return;
      }
      appendOpenedFileTab(opened);
      closeMenus();
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedOpenFile);
    }
  }, [
    appendOpenedFileTab,
    alwaysOnTop,
    closeMenus,
    fileOpenBehavior,
    messages.app.statuses,
    messages.app.windowTitles.main,
    windowHandle,
  ]);

  const saveTabAs = useCallback(async (tab: Tab) => {
    try {
      setStatus(messages.app.statuses.openingSaveDialog);
      const suggested = isUntitledTitle(tab.title)
        ? messages.app.defaultSaveName
        : (tab.title.trim() || messages.app.defaultSaveName);
      const resolvedPath = await pickSavePath(suggested);
      if (!resolvedPath) {
        setStatus(messages.app.statuses.saveDialogReturnedNoPath);
        return false;
      }
      setStatus(messages.app.statuses.savingTo(resolvedPath));
      await invoke("write_text_file", {
        path: resolvedPath,
        contents: htmlToText(tab.content),
      });
      const nextTitle = getFileNameFromPath(resolvedPath);
      const pathMap = getPathMap();
      setPathMap({ ...pathMap, [tab.id]: resolvedPath });
      setTabs((prev) => {
        const nextTabs = prev.map((item) =>
          item.id === tab.id
            ? { ...item, title: nextTitle, filePath: resolvedPath }
            : item,
        );
        persistState(nextTabs);
        return nextTabs;
      });
      savedTabsRef.current = {
        ...savedTabsRef.current,
        [tab.id]: { title: nextTitle, content: tab.content },
      };
      setSavedVersion((prev) => prev + 1);
      setStatus(messages.app.statuses.saved(nextTitle));
      closeMenus();
      return true;
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedSaveFile(String(error)));
      return false;
    }
  }, [
    closeMenus,
    getFileNameFromPath,
    htmlToText,
    getPathMap,
    messages.app.defaultSaveName,
    messages.app.statuses,
    pickSavePath,
    persistState,
    setPathMap,
  ]);

  const saveActiveTabAs = useCallback(async () => {
    if (!activeTab) return;
    await saveTabAs(activeTab);
  }, [activeTab, saveTabAs]);

  const saveTab = useCallback(async (tab: Tab) => {
    let resolvedPath = tab.filePath ?? null;
    if (!resolvedPath) {
      const pathMap = getPathMap();
      resolvedPath = pathMap[tab.id] ?? null;
    }
    if (!resolvedPath) {
      return await saveTabAs(tab);
    }
    try {
      setStatus(messages.app.statuses.savingTo(resolvedPath));
      await invoke("write_text_file", {
        path: resolvedPath,
        contents: htmlToText(tab.content),
      });
      const pathMap = getPathMap();
      if (!pathMap[tab.id]) {
        setPathMap({
          ...pathMap,
          [tab.id]: resolvedPath,
        });
      }
      savedTabsRef.current = {
        ...savedTabsRef.current,
        [tab.id]: { title: tab.title, content: tab.content },
      };
      setSavedVersion((prev) => prev + 1);
      setTabs((prev) => {
        persistState(prev);
        return prev;
      });
      setStatus(messages.app.statuses.saved(tab.title));
      closeMenus();
      return true;
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedSaveFile(String(error)));
      return false;
    }
  }, [
    closeMenus,
    htmlToText,
    getPathMap,
    messages.app.statuses,
    persistState,
    saveTabAs,
    setPathMap,
  ]);

  const saveActiveTab = useCallback(async () => {
    if (!activeTab) return;
    await saveTab(activeTab);
  }, [activeTab, saveTab]);

  const saveAllTabs = useCallback(async () => {
    const tabsWithPath = tabs.filter((tab) => tab.filePath);
    if (tabsWithPath.length === 0) {
      setStatus(messages.app.statuses.noSavedFilesToUpdate);
      closeMenus();
      return;
    }
    try {
      await Promise.all(
        tabsWithPath.map((tab) =>
          invoke("write_text_file", {
            path: tab.filePath,
            contents: htmlToText(tab.content),
          }),
        ),
      );
      savedTabsRef.current = {
        ...savedTabsRef.current,
        ...Object.fromEntries(
          tabsWithPath.map((tab) => [tab.id, { title: tab.title, content: tab.content }]),
        ),
      };
      setSavedVersion((prev) => prev + 1);
      persistState(tabs);
      setStatus(messages.app.statuses.savedAll);
      closeMenus();
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedSaveAll);
    }
  }, [closeMenus, htmlToText, messages.app.statuses, persistState, tabs]);

  const openNewWindow = useCallback(async () => {
    try {
      const size = await windowHandle.outerSize();
      const label = `alwaysmemo-${crypto.randomUUID()}`;
      const alwaysOnTopParam = alwaysOnTop ? "1" : "0";
      const newWindow = new WebviewWindow(label, {
        url: `/?instance=${label}&alwaysOnTop=${alwaysOnTopParam}`,
        width: size.width,
        height: size.height,
        decorations: false,
        resizable: true,
        title: messages.app.windowTitles.main,
      });
      newWindow.once("tauri://created", async () => {
        try {
          await newWindow.show();
          await newWindow.setFocus();
          if (alwaysOnTop) {
            await newWindow.setAlwaysOnTop(true);
          }
        } catch (error) {
          console.error("Failed to focus new window", error);
        }
      });
      newWindow.once("tauri://error", (error) => {
        console.error("Failed to create new window", error);
        setStatus(messages.app.statuses.failedOpenNewWindow);
      });
      closeMenus();
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedOpenNewWindow);
    }
  }, [
    alwaysOnTop,
    closeMenus,
    messages.app.statuses.failedOpenNewWindow,
    messages.app.windowTitles.main,
    windowHandle,
  ]);

  useEffect(() => {
    const syncFromStorage = (event: StorageEvent) => {
      if (event.key !== GLOBAL_SHORTCUT_SYNC_KEY || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue) as GlobalShortcutSyncMessage;
        setGlobalShortcutsPreference(payload.enabled, payload.reason, { broadcast: false });
      } catch (error) {
        console.error("Failed to sync global shortcut preference", error);
      }
    };

    let unlistenFocusChanged: (() => void) | undefined;
    window.addEventListener("storage", syncFromStorage);
    void ensureGlobalShortcutsSingleWindow();
    void windowHandle.onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      void ensureGlobalShortcutsSingleWindow();
    }).then((cleanup) => {
      unlistenFocusChanged = cleanup;
    }).catch((error) => {
      console.error("Failed to listen for focus changes", error);
    });

    return () => {
      window.removeEventListener("storage", syncFromStorage);
      unlistenFocusChanged?.();
    };
  }, [ensureGlobalShortcutsSingleWindow, setGlobalShortcutsPreference, windowHandle]);

  const setAlwaysOnTop = useCallback(
    async (value: boolean) => {
      try {
        const confirmed = await invoke<boolean>("set_always_on_top", { value });
        setAlwaysOnTopState(confirmed);
        setStatus(
          confirmed
            ? messages.app.statuses.alwaysOnTopEnabled
            : messages.app.statuses.alwaysOnTopDisabled,
        );
      } catch (error) {
        console.error(error);
        setStatus(messages.app.statuses.failedSetAlwaysOnTop);
      }
    },
    [messages.app.statuses],
  );

  const settingsSnapshot = useMemo<BridgeSettingsSnapshot>(() => ({
    alwaysOnTop,
    useGlobalShortcuts,
    showStatusBar,
    wrapAtRightEdge,
    editorFontSizePx,
    lineSpacing,
    themeMode,
    sessionBehavior,
    fileOpenBehavior,
    languagePreference,
  }), [
    alwaysOnTop,
    editorFontSizePx,
    fileOpenBehavior,
    languagePreference,
    lineSpacing,
    sessionBehavior,
    showStatusBar,
    themeMode,
    useGlobalShortcuts,
    wrapAtRightEdge,
  ]);

  useEffect(() => {
    settingsSnapshotRef.current = settingsSnapshot;
  }, [settingsSnapshot]);

  const emitSettingsSnapshot = useCallback(
    async (targetLabel = settingsWindowLabel, snapshot = settingsSnapshotRef.current) => {
      const target = await WebviewWindow.getByLabel(targetLabel);
      if (!target) return;
      await currentWebviewWindow.emitTo(targetLabel, SETTINGS_SYNC_EVENT, {
        sourceLabel: currentWindowLabel,
        snapshot,
      });
    },
    [currentWebviewWindow, currentWindowLabel, settingsWindowLabel],
  );

  const applySettingsPatch = useCallback(async (patch: SettingsPatch) => {
    let nextSnapshot: BridgeSettingsSnapshot = settingsSnapshotRef.current;

    if (patch.themeMode !== undefined) {
      setThemeMode(patch.themeMode);
      nextSnapshot = { ...nextSnapshot, themeMode: patch.themeMode };
    }
    if (patch.lineSpacing !== undefined) {
      setLineSpacing(patch.lineSpacing);
      nextSnapshot = { ...nextSnapshot, lineSpacing: patch.lineSpacing };
    }
    if (patch.editorFontSizePx !== undefined) {
      setEditorFontSizePx(patch.editorFontSizePx);
      setEditorFontSizeInput(String(patch.editorFontSizePx));
      nextSnapshot = { ...nextSnapshot, editorFontSizePx: patch.editorFontSizePx };
    }
    if (patch.wrapAtRightEdge !== undefined) {
      setWrapAtRightEdge(patch.wrapAtRightEdge);
      nextSnapshot = { ...nextSnapshot, wrapAtRightEdge: patch.wrapAtRightEdge };
    }
    if (patch.showStatusBar !== undefined) {
      setShowStatusBar(patch.showStatusBar);
      nextSnapshot = { ...nextSnapshot, showStatusBar: patch.showStatusBar };
    }
    if (patch.sessionBehavior !== undefined) {
      setSessionBehavior(patch.sessionBehavior);
      nextSnapshot = { ...nextSnapshot, sessionBehavior: patch.sessionBehavior };
    }
    if (patch.fileOpenBehavior !== undefined) {
      setFileOpenBehavior(patch.fileOpenBehavior);
      nextSnapshot = { ...nextSnapshot, fileOpenBehavior: patch.fileOpenBehavior };
    }
    if (patch.languagePreference !== undefined) {
      setLanguagePreference(patch.languagePreference);
      nextSnapshot = { ...nextSnapshot, languagePreference: patch.languagePreference };
    }
    if (patch.alwaysOnTop !== undefined) {
      await setAlwaysOnTop(patch.alwaysOnTop);
      nextSnapshot = { ...nextSnapshot, alwaysOnTop: patch.alwaysOnTop };
    }
    if (patch.useGlobalShortcuts !== undefined) {
      if (patch.useGlobalShortcuts) {
        const canEnable = await ensureGlobalShortcutsSingleWindow();
        if (canEnable) {
          setGlobalShortcutsPreference(true, "manual");
          nextSnapshot = { ...nextSnapshot, useGlobalShortcuts: true };
        } else {
          nextSnapshot = { ...nextSnapshot, useGlobalShortcuts: false };
        }
      } else {
        setGlobalShortcutsPreference(false, "manual");
        nextSnapshot = { ...nextSnapshot, useGlobalShortcuts: false };
      }
    }

    settingsSnapshotRef.current = nextSnapshot;
    return nextSnapshot;
  }, [
    ensureGlobalShortcutsSingleWindow,
    setAlwaysOnTop,
    setGlobalShortcutsPreference,
  ]);

  const openSettingsWindow = useCallback(async () => {
    closeMenus();
    setShowSearchBox(false);
    const existing = await WebviewWindow.getByLabel(settingsWindowLabel);
    if (existing) {
      await emitSettingsSnapshot(settingsWindowLabel);
      await revealAuxWindow(existing);
      return;
    }

    const settingsWindow = new WebviewWindow(settingsWindowLabel, {
      url: `/?view=settings&source=${encodeURIComponent(currentWindowLabel)}&instance=${encodeURIComponent(settingsWindowLabel)}`,
      width: 960,
      height: 720,
      minWidth: 760,
      minHeight: 620,
      decorations: false,
      resizable: true,
      title: messages.app.windowTitles.settings,
    });

    settingsWindow.once("tauri://created", async () => {
      try {
        await emitSettingsSnapshot(settingsWindowLabel);
        await revealAuxWindow(settingsWindow);
      } catch (error) {
        console.error("Failed to focus settings window", error);
      }
    });

    settingsWindow.once("tauri://error", (error) => {
      console.error("Failed to create settings window", error);
      setStatus(messages.app.statuses.failedOpenSettingsWindow);
    });
  }, [
    closeMenus,
    currentWindowLabel,
    emitSettingsSnapshot,
    messages.app.statuses.failedOpenSettingsWindow,
    messages.app.windowTitles.settings,
    revealAuxWindow,
    settingsWindowLabel,
  ]);

  const openDetailedHelp = useCallback(async () => {
    try {
      await openUrl(HELP_URL);
      setHelpPanelOpen(false);
    } catch (error) {
      console.error("Failed to open help URL", error);
      setStatus(messages.app.statuses.failedOpenDetailedHelp);
    }
  }, [messages.app.statuses.failedOpenDetailedHelp]);

  useEffect(() => {
    let unlistenRequest: (() => void) | undefined;
    let unlistenUpdate: (() => void) | undefined;

    void currentWebviewWindow.listen<SettingsRequestPayload>(SETTINGS_REQUEST_EVENT, ({ payload }) => {
      void emitSettingsSnapshot(payload.settingsLabel);
    }).then((cleanup) => {
      unlistenRequest = cleanup;
    }).catch((error) => {
      console.error("Failed to listen for settings requests", error);
    });

    void currentWebviewWindow.listen<{
      settingsLabel: string;
      patch: SettingsPatch;
    }>(SETTINGS_UPDATE_EVENT, ({ payload }) => {
      if (payload.settingsLabel !== settingsWindowLabel) return;
      void (async () => {
        const nextSnapshot = await applySettingsPatch(payload.patch);
        await emitSettingsSnapshot(payload.settingsLabel, nextSnapshot);
      })();
    }).then((cleanup) => {
      unlistenUpdate = cleanup;
    }).catch((error) => {
      console.error("Failed to listen for settings updates", error);
    });

    return () => {
      unlistenRequest?.();
      unlistenUpdate?.();
    };
  }, [
    applySettingsPatch,
    currentWebviewWindow,
    emitSettingsSnapshot,
    settingsWindowLabel,
  ]);

  useEffect(() => {
    void emitSettingsSnapshot();
  }, [emitSettingsSnapshot, settingsSnapshot]);

  const toggleAlwaysOnTop = useCallback(async () => {
    const now = performance.now();
    if (now - toggleLockRef.current < 300) return;
    toggleLockRef.current = now;
    try {
      const next = await invoke<boolean>("toggle_always_on_top");
      setAlwaysOnTopState(next);
      setStatus(
        next
          ? messages.app.statuses.alwaysOnTopEnabled
          : messages.app.statuses.alwaysOnTopDisabled,
      );
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedToggleAlwaysOnTop);
    }
  }, [messages.app.statuses]);

  const snapLeft = useCallback(async () => {
    try {
      await invoke("snap_left");
      setSnap("left");
      setStatus(messages.app.statuses.snappedLeft);
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedSnapLeft);
    }
  }, [messages.app.statuses.failedSnapLeft, messages.app.statuses.snappedLeft]);

  const snapRight = useCallback(async () => {
    try {
      await invoke("snap_right");
      setSnap("right");
      setStatus(messages.app.statuses.snappedRight);
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedSnapRight);
    }
  }, [messages.app.statuses.failedSnapRight, messages.app.statuses.snappedRight]);

  const snapTop = useCallback(async () => {
    try {
      await invoke("snap_top");
      setSnap("top");
      setStatus(messages.app.statuses.snappedTop);
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedSnapTop);
    }
  }, [messages.app.statuses.failedSnapTop, messages.app.statuses.snappedTop]);

  const snapBottom = useCallback(async () => {
    try {
      await invoke("snap_bottom");
      setSnap("bottom");
      setStatus(messages.app.statuses.snappedBottom);
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedSnapBottom);
    }
  }, [messages.app.statuses.failedSnapBottom, messages.app.statuses.snappedBottom]);

  const resizeToMinimum = useCallback(async () => {
    try {
      await windowHandle.setSize(new LogicalSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT));
      setStatus(messages.app.statuses.resizedMinimum);
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedResizeMinimum);
    }
  }, [messages.app.statuses.failedResizeMinimum, messages.app.statuses.resizedMinimum, windowHandle]);

  const resizeToFitContent = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    try {
      const maxWidth = window.screen?.availWidth ?? window.innerWidth;
      const maxHeight = window.screen?.availHeight ?? window.innerHeight;
      const computed = window.getComputedStyle(editor);
      const font = `${computed.fontStyle} ${computed.fontVariant} ${computed.fontWeight} ${computed.fontSize} / ${computed.lineHeight} ${computed.fontFamily}`;
      const lines = (editor.innerText ?? "").split(/\r?\n/);
      const lineCount = Math.max(lines.length, 1);
      const fontSize = parseFloat(computed.fontSize) || 14;
      const lineHeightValue =
        computed.lineHeight === "normal"
          ? Math.round(fontSize * 1.4)
          : parseFloat(computed.lineHeight) || Math.round(fontSize * 1.4);

      if (!measureCanvasRef.current) {
        measureCanvasRef.current = document.createElement("canvas");
      }
      const ctx = measureCanvasRef.current.getContext("2d");
      const maxLineWidth = ctx
        ? lines.reduce((max, line) => {
            ctx.font = font;
            return Math.max(max, ctx.measureText(line || " ").width);
          }, 0)
        : editor.scrollWidth;

      const paddingX =
        parseFloat(computed.paddingLeft) + parseFloat(computed.paddingRight);
      const paddingY =
        parseFloat(computed.paddingTop) + parseFloat(computed.paddingBottom);
      const borderX =
        parseFloat(computed.borderLeftWidth) + parseFloat(computed.borderRightWidth);
      const borderY =
        parseFloat(computed.borderTopWidth) + parseFloat(computed.borderBottomWidth);

      const targetTextWidth = Math.ceil(maxLineWidth + paddingX + borderX + 2);
      const targetTextHeight = Math.ceil(lineCount * lineHeightValue + paddingY + borderY + 2);

      const chromeWidth = window.innerWidth - editor.clientWidth;
      const chromeHeight = window.innerHeight - editor.clientHeight;

      const nextWidth = Math.max(
        MIN_WINDOW_WIDTH,
        Math.round(targetTextWidth + chromeWidth),
      );
      const FIT_CONTENT_HEIGHT_TRIM = 32;
      const nextHeight = Math.max(
        MIN_WINDOW_HEIGHT,
        Math.round(targetTextHeight + chromeHeight - FIT_CONTENT_HEIGHT_TRIM),
      );

      await windowHandle.setSize(
        new LogicalSize(Math.min(nextWidth, maxWidth), Math.min(nextHeight, maxHeight)),
      );
      setStatus(messages.app.statuses.resizedFitContent);
    } catch (error) {
      console.error(error);
      setStatus(messages.app.statuses.failedResizeFitContent);
    }
  }, [messages.app.statuses.failedResizeFitContent, messages.app.statuses.resizedFitContent, windowHandle]);

  useEffect(() => {
    const initState = async () => {
      try {
        await windowHandle.setMinSize(
          new LogicalSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
        );
        const current = await invoke<boolean>("get_always_on_top");
        const params = new URLSearchParams(window.location.search);
        const alwaysOnTopParam = params.get("alwaysOnTop");
        const openPathParam = params.get("openPath");
        const forceAlwaysOnTopDefined = alwaysOnTopParam !== null;
        const forceAlwaysOnTop =
          alwaysOnTopParam === "1" || alwaysOnTopParam === "true";
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored) as PersistedState;
          const nextSessionBehavior = parsed.sessionBehavior ?? "restore";
          const nextFileOpenBehavior = parsed.fileOpenBehavior ?? "existing";
          const nextEditorFontSizePx = parsed.editorFontSizePx ?? 14;
          const nextLineSpacing = parsed.lineSpacing ?? "standard";
          const nextThemeMode = parsed.themeMode ?? "system";
          const nextLanguagePreference = parsed.languagePreference ?? "system";
          const nextShowStatusBar = parsed.showStatusBar ?? true;
          const nextWrapAtRightEdge = parsed.wrapAtRightEdge ?? true;
          setSessionBehavior(nextSessionBehavior);
          setFileOpenBehavior(nextFileOpenBehavior);
          setEditorFontSizePx(nextEditorFontSizePx);
          setLineSpacing(nextLineSpacing);
          setThemeMode(nextThemeMode);
          setLanguagePreference(nextLanguagePreference);
          setShowStatusBar(nextShowStatusBar);
          setWrapAtRightEdge(nextWrapAtRightEdge);
          const pathMap = getPathMap();
          const shouldRestoreTabs = nextSessionBehavior === "restore";
          const restoredTabs = ((shouldRestoreTabs && parsed.tabs.length)
            ? parsed.tabs
            : [{ id: "initial", title: messages.app.untitledTab, content: "" }]
          ).map((tab) => ({
            ...tab,
            content: normalizeHtml(tab.content),
            filePath: tab.filePath ?? pathMap[tab.id] ?? null,
          }));
          savedTabsRef.current = Object.fromEntries(
            restoredTabs.map((tab) => [tab.id, { title: tab.title, content: tab.content }]),
          );
          setTabs(restoredTabs);
          const validActive =
            parsed.activeTabId && restoredTabs.some((t) => t.id === parsed.activeTabId)
              ? parsed.activeTabId
              : restoredTabs[0]?.id ?? "initial";
          setActiveTabId(validActive);
          setUseGlobalShortcuts(parsed.useGlobalShortcuts ?? DEFAULT_USE_GLOBAL_SHORTCUTS);
          setSnap(parsed.snap ?? null);
          const nextAlwaysOnTop = forceAlwaysOnTopDefined
            ? forceAlwaysOnTop
            : parsed.alwaysOnTop ?? current;
          setAlwaysOnTopState(nextAlwaysOnTop);
          if (nextAlwaysOnTop) {
            await invoke("set_always_on_top", { value: true });
          }
          if (parsed.snap === "left") {
            await snapLeft();
          } else if (parsed.snap === "right") {
            await snapRight();
          } else if (parsed.snap === "top") {
            await snapTop();
          } else if (parsed.snap === "bottom") {
            await snapBottom();
          }
        } else {
          setSessionBehavior("restore");
          setFileOpenBehavior("existing");
          setEditorFontSizePx(14);
          setLineSpacing("standard");
          setThemeMode("system");
          setLanguagePreference("system");
          setUseGlobalShortcuts(DEFAULT_USE_GLOBAL_SHORTCUTS);
          setShowStatusBar(true);
          setWrapAtRightEdge(true);
          const nextAlwaysOnTop = forceAlwaysOnTopDefined
            ? forceAlwaysOnTop
            : current;
          setAlwaysOnTopState(nextAlwaysOnTop);
          if (nextAlwaysOnTop) {
            await invoke("set_always_on_top", { value: true });
          }
          savedTabsRef.current = {
            initial: { title: messages.app.untitledTab, content: "" },
          };
        }
        if (openPathParam) {
          try {
            const decodedPath = decodeURIComponent(openPathParam);
            await openFilesByPaths([decodedPath], { announce: false });
          } catch (error) {
            console.error("Failed to open startup path", error);
          }
        }
      } catch (error) {
        console.error(error);
        setStatus(messages.app.statuses.failedReadAlwaysOnTopState);
      } finally {
        settingsReadyRef.current = true;
        setStartupStateReady(true);
      }
    };
    void initState();
  }, []);

  useEffect(() => {
    if (!startupStateReady || currentWindowLabel !== "main") return;

    let cancelled = false;
    let busy = false;
    let rerunRequested = false;
    let unlistenPendingOpen: (() => void) | undefined;

    const pumpPendingOpenFiles = () => {
      if (cancelled) return;
      if (busy) {
        rerunRequested = true;
        return;
      }
      busy = true;
      void (async () => {
        try {
          await drainPendingOpenFiles();
        } catch (error) {
          console.error("Failed to drain pending external file opens", error);
          setStatus(messages.app.statuses.failedOpenFile);
        } finally {
          busy = false;
          if (rerunRequested && !cancelled) {
            rerunRequested = false;
            pumpPendingOpenFiles();
          }
        }
      })();
    };

    void currentWebviewWindow.listen(PENDING_OPEN_FILES_EVENT, () => {
      pumpPendingOpenFiles();
    }).then((cleanup) => {
      unlistenPendingOpen = cleanup;
      pumpPendingOpenFiles();
    }).catch((error) => {
      console.error("Failed to listen for pending open files", error);
      setStatus(messages.app.statuses.failedOpenFile);
    });

    return () => {
      cancelled = true;
      unlistenPendingOpen?.();
    };
  }, [
    currentWindowLabel,
    currentWebviewWindow,
    drainPendingOpenFiles,
    messages.app.statuses.failedOpenFile,
    startupStateReady,
  ]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    setSystemPrefersDark(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(HELP_HINT_STORAGE_KEY);
      if (!seen) {
        setHelpHintVisible(true);
      }
    } catch {
      setHelpHintVisible(true);
    }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const dark = effectiveTheme === "dark";
    root.classList.toggle("global-dark", dark);
    return () => {
      root.classList.remove("global-dark");
    };
  }, [effectiveTheme]);

  useEffect(() => {
    if (!settingsReadyRef.current) return;
    if (persistStateTimerRef.current !== null) {
      window.clearTimeout(persistStateTimerRef.current);
    }
    persistStateTimerRef.current = window.setTimeout(() => {
      persistState(tabs, activeTabId);
      persistStateTimerRef.current = null;
    }, STATE_PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistStateTimerRef.current !== null) {
        window.clearTimeout(persistStateTimerRef.current);
      }
    };
  }, [activeTabId, fileOpenBehavior, lineSpacing, persistState, sessionBehavior, tabs, themeMode]);

  useEffect(() => {
    const handleSelectionChange = () => {
      saveEditorSelection();
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!editor || !selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (
        editor.contains(range.startContainer) &&
        editor.contains(range.endContainer)
      ) {
        scheduleCursorIndexUpdate();
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [saveEditorSelection, scheduleCursorIndexUpdate]);

  useEffect(() => {
    return () => {
      if (cursorUpdateRafRef.current !== null) {
        window.cancelAnimationFrame(cursorUpdateRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(recentClosedKey);
      const parsed = raw ? (JSON.parse(raw) as RecentClosedFile[]) : [];
      if (!Array.isArray(parsed)) {
        setRecentClosedFiles([]);
        return;
      }
      const cleaned = parsed
        .filter(
          (item) =>
            Boolean(item?.path) &&
            Boolean(item?.title) &&
            /\.txt$/i.test(item.path),
        )
        .slice(0, MAX_RECENT_CLOSED_FILES);
      setRecentClosedFiles(cleaned);
    } catch {
      setRecentClosedFiles([]);
    }
  }, [recentClosedKey]);

  useEffect(() => {
    if (openMenu !== "file") {
      setFileMenuStyle(undefined);
      return;
    }

    const updatePlacement = () => {
      window.requestAnimationFrame(() => {
        const wrapper = fileMenuWrapperRef.current;
        const panel = fileMenuRef.current;
        if (!wrapper || !panel) return;

        const margin = 8;
        const wrapperRect = wrapper.getBoundingClientRect();
        const panelWidth = Math.max(panel.offsetWidth, 220);
        const panelHeight = Math.max(panel.scrollHeight, panel.offsetHeight);
        const availableViewportHeight = Math.max(window.innerHeight - margin * 2, 180);
        const maxHeight = Math.min(panelHeight, availableViewportHeight);
        const desiredTop = wrapperRect.bottom + 6;
        const maxViewportTop = Math.max(margin, window.innerHeight - margin - maxHeight);
        const viewportTop = Math.min(Math.max(desiredTop, margin), maxViewportTop);

        let left = 0;
        const overflowRight = wrapperRect.left + panelWidth - (window.innerWidth - margin);
        if (overflowRight > 0) {
          left -= overflowRight;
        }
        if (wrapperRect.left + left < margin) {
          left = margin - wrapperRect.left;
        }

        setFileMenuStyle({
          left: `${Math.round(left)}px`,
          top: `${Math.round(viewportTop - wrapperRect.top)}px`,
          bottom: "auto",
          maxHeight: `${Math.round(maxHeight)}px`,
        });
      });
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    return () => window.removeEventListener("resize", updatePlacement);
  }, [openMenu]);

  useEffect(() => {
    if (openMenu !== "edit") {
      setEditMenuStyle(undefined);
      return;
    }

    const updatePlacement = () => {
      window.requestAnimationFrame(() => {
        const wrapper = editMenuWrapperRef.current;
        const panel = editMenuRef.current;
        if (!wrapper || !panel) return;

        const margin = 8;
        const wrapperRect = wrapper.getBoundingClientRect();
        const panelWidth = Math.max(panel.offsetWidth, 180);
        const panelHeight = Math.max(panel.scrollHeight, panel.offsetHeight);
        const availableViewportHeight = Math.max(window.innerHeight - margin * 2, 140);
        const maxHeight = Math.min(panelHeight, availableViewportHeight);
        const desiredTop = wrapperRect.bottom + 6;
        const maxViewportTop = Math.max(margin, window.innerHeight - margin - maxHeight);
        const viewportTop = Math.min(Math.max(desiredTop, margin), maxViewportTop);

        let left = 0;
        const overflowRight = wrapperRect.left + panelWidth - (window.innerWidth - margin);
        if (overflowRight > 0) {
          left -= overflowRight;
        }
        if (wrapperRect.left + left < margin) {
          left = margin - wrapperRect.left;
        }

        setEditMenuStyle({
          left: `${Math.round(left)}px`,
          top: `${Math.round(viewportTop - wrapperRect.top)}px`,
          bottom: "auto",
          maxHeight: `${Math.round(maxHeight)}px`,
        });
      });
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    return () => window.removeEventListener("resize", updatePlacement);
  }, [openMenu]);

  useEffect(() => {
    if (openMenu !== "view") {
      setViewMenuStyle(undefined);
      return;
    }

    const updatePlacement = () => {
      window.requestAnimationFrame(() => {
        const wrapper = viewMenuWrapperRef.current;
        const panel = viewMenuRef.current;
        if (!wrapper || !panel) return;

        const margin = 8;
        const wrapperRect = wrapper.getBoundingClientRect();
        const panelWidth = Math.max(panel.offsetWidth, 180);
        const panelHeight = Math.max(panel.scrollHeight, panel.offsetHeight);
        const availableViewportHeight = Math.max(window.innerHeight - margin * 2, 140);
        const maxHeight = Math.min(panelHeight, availableViewportHeight);
        const desiredTop = wrapperRect.bottom + 6;
        const maxViewportTop = Math.max(margin, window.innerHeight - margin - maxHeight);
        const viewportTop = Math.min(Math.max(desiredTop, margin), maxViewportTop);

        let left = 0;
        const overflowRight = wrapperRect.left + panelWidth - (window.innerWidth - margin);
        if (overflowRight > 0) {
          left -= overflowRight;
        }
        if (wrapperRect.left + left < margin) {
          left = margin - wrapperRect.left;
        }

        setViewMenuStyle({
          left: `${Math.round(left)}px`,
          top: `${Math.round(viewportTop - wrapperRect.top)}px`,
          bottom: "auto",
          maxHeight: `${Math.round(maxHeight)}px`,
        });
      });
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    return () => window.removeEventListener("resize", updatePlacement);
  }, [openMenu]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (menuRef.current.contains(event.target as Node)) return;
      setOpenMenu(null);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!helpPanelOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (helpPanelRef.current?.contains(target)) return;
      if (helpButtonRef.current?.contains(target)) return;
      setHelpPanelOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [helpPanelOpen]);

  useEffect(() => {
    if (!helpHintVisible || helpPanelOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (helpHintRef.current?.contains(target)) return;
      if (helpButtonRef.current?.contains(target)) return;
      dismissHelpHint();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [dismissHelpHint, helpHintVisible, helpPanelOpen]);

  useEffect(() => {
    if (!goToLineOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGoToLineOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goToLineOpen]);

  useEffect(() => {
    if (!helpPanelOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setHelpPanelOpen(false);
      helpButtonRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [helpPanelOpen]);

  useEffect(() => {
    if (!helpHintVisible || helpPanelOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      dismissHelpHint();
      helpButtonRef.current?.focus();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dismissHelpHint, helpHintVisible, helpPanelOpen]);

  useEffect(() => {
    if (!goToLineOpen) return;
    window.requestAnimationFrame(() => {
      goToLineInputRef.current?.focus();
      goToLineInputRef.current?.select();
    });
  }, [goToLineOpen]);

  const revealTabById = useCallback((id: string, retriesLeft = 10) => {
    pendingRevealTabIdRef.current = id;
    const reveal = (retries: number) => {
      const pendingId = pendingRevealTabIdRef.current;
      if (!pendingId) return;
      const scroller = tabsScrollerRef.current;
      if (!scroller) return;
      const targetTab = Array.from(scroller.querySelectorAll<HTMLElement>(".tab")).find(
        (element) => element.dataset.tabId === pendingId,
      );
      if (!targetTab) {
        if (retries > 0) {
          window.requestAnimationFrame(() => reveal(retries - 1));
        }
        return;
      }

      const viewLeft = scroller.scrollLeft;
      const viewRight = viewLeft + scroller.clientWidth;
      const tabLeft = targetTab.offsetLeft;
      const tabRight = tabLeft + targetTab.offsetWidth;
      let nextLeft = viewLeft;
      if (tabLeft < viewLeft) {
        nextLeft = tabLeft - 8;
      } else if (tabRight > viewRight) {
        nextLeft = tabRight - scroller.clientWidth + 8;
      }

      const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      nextLeft = Math.max(0, Math.min(maxLeft, nextLeft));
      if (tabsWheelRafRef.current !== null) {
        window.cancelAnimationFrame(tabsWheelRafRef.current);
        tabsWheelRafRef.current = null;
      }
      tabsWheelTargetRef.current = nextLeft;
      scroller.scrollTo({ left: nextLeft, behavior: "smooth" });
      pendingRevealTabIdRef.current = null;
    };

    window.requestAnimationFrame(() => reveal(retriesLeft));
  }, []);

  const isTabDirty = useCallback((tab: Tab) => {
    const saved = savedTabsRef.current[tab.id];
    if (!saved) return true;
    return saved.title !== tab.title || saved.content !== tab.content;
  }, []);

  const dirtyTabCount = useMemo(
    () => tabs.filter((tab) => isTabDirty(tab)).length,
    [isTabDirty, tabs],
  );

  const addTab = () => {
    const id = crypto.randomUUID();
    const newTab: Tab = { id, title: messages.app.untitledTab, content: "" };
    savedTabsRef.current = {
      ...savedTabsRef.current,
      [id]: { title: newTab.title, content: newTab.content },
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    revealTabById(id);
  };

  const performRemoveTab = useCallback((id: string) => {
    setTabs((prev) => {
      const removed = prev.find((t) => t.id === id);
      if (removed) {
        pushRecentClosedFile(removed);
      }
      tabHistoryRef.current = tabHistoryRef.current.filter((tabId) => tabId !== id);
      const nextTabs = prev.filter((t) => t.id !== id);
      if (nextTabs.length === 0) {
        const fallback: Tab = { id: "initial", title: messages.app.untitledTab, content: "" };
        setActiveTabId(fallback.id);
        return [fallback];
      }
      if (activeTabIdRef.current === id) {
        const nextActiveId =
          [...tabHistoryRef.current]
            .reverse()
            .find((tabId) => tabId !== id && nextTabs.some((tab) => tab.id === tabId)) ??
          nextTabs[0].id;
        setActiveTabId(nextActiveId);
      }
      return nextTabs;
    });
  }, [messages.app.untitledTab, pushRecentClosedFile]);

  const closeTabWithAnimation = useCallback((id: string) => {
    if (tabs.length === 1 && tabs[0]?.id === id) {
      allowImmediateCloseRef.current = true;
      void windowHandle.close().finally(() => {
        allowImmediateCloseRef.current = false;
      });
      return;
    }
    if (tabCloseTimerRef.current[id]) return;
    setClosingTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    tabCloseTimerRef.current[id] = window.setTimeout(() => {
      delete tabCloseTimerRef.current[id];
      setClosingTabIds((prev) => prev.filter((tabId) => tabId !== id));
      performRemoveTab(id);
    }, TAB_CLOSE_ANIMATION_MS);
  }, [performRemoveTab, tabs, windowHandle]);

  const requestRemoveTab = useCallback((id: string) => {
    if (closingTabIds.includes(id)) return;
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (isTabDirty(tab)) {
      setDeletePromptTabId(tab.id);
      return;
    }
    closeTabWithAnimation(id);
  }, [closeTabWithAnimation, closingTabIds, isTabDirty, tabs]);

  useEffect(() => {
    return () => {
      Object.values(tabCloseTimerRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      tabCloseTimerRef.current = {};
    };
  }, []);

  const closeActiveTab = useCallback(() => {
    if (!activeTab) return;
    void requestRemoveTab(activeTab.id);
    closeMenus();
  }, [activeTab, closeMenus, requestRemoveTab]);

  const cycleActiveTab = useCallback((direction: 1 | -1) => {
    if (tabs.length <= 1) return;
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + direction + tabs.length) % tabs.length;
    const nextTabId = tabs[nextIndex].id;
    setActiveTabId(nextTabId);
    revealTabById(nextTabId);
  }, [activeTabId, revealTabById, tabs]);

  const renameTab = (id: string, title: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  };

  const updateContent = useCallback((content: string) => {
    if (!activeTab) return;
    // Live editor DOM stays on a trusted path; strip transient search markup before persisting.
    const clean = stripTrustedSearchHighlights(content);
    if (clean === activeTab.content) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, content: clean } : t)),
    );
  }, [activeTab]);

  const runEditorCommand = useCallback((command: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    restoreEditorSelection();
    document.execCommand(command);
    window.requestAnimationFrame(() => {
      updateContent(editor.innerHTML);
      updateCursorIndex();
    });
  }, [restoreEditorSelection, updateContent, updateCursorIndex]);

  const pasteFromClipboard = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    restoreEditorSelection();
    if (navigator.clipboard?.readText) {
      try {
        const text = normalizePlainText(await navigator.clipboard.readText());
        document.execCommand("insertText", false, text);
      } catch (error) {
        console.error("clipboard read failed", error);
        setStatus(messages.app.statuses.clipboardUnavailable);
      }
    } else {
      setStatus(messages.app.statuses.clipboardUnavailable);
    }
    window.requestAnimationFrame(() => {
      updateContent(editor.innerHTML);
      updateCursorIndex();
    });
  }, [
    messages.app.statuses.clipboardUnavailable,
    normalizePlainText,
    restoreEditorSelection,
    updateContent,
    updateCursorIndex,
  ]);

  const handleEditorPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    restoreEditorSelection();
    const text = normalizePlainText(event.clipboardData.getData("text/plain"));
    document.execCommand("insertText", false, text);
    window.requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      updateContent(editor.innerHTML);
      updateCursorIndex();
    });
  }, [restoreEditorSelection, updateContent, updateCursorIndex]);

  const handleEditorDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    // Dropped rich HTML/files bypass paste sanitization, so accept plain text only.
    event.preventDefault();
    restoreEditorSelection();
    const text = normalizePlainText(event.dataTransfer.getData("text/plain"));
    if (!text) return;
    document.execCommand("insertText", false, text);
    window.requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      updateContent(editor.innerHTML);
      updateCursorIndex();
    });
  }, [restoreEditorSelection, updateContent, updateCursorIndex]);

  const focusSearchBox = useCallback(() => {
    closeMenus();
    setShowSearchBox(true);
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [closeMenus]);

  const focusReplaceBox = useCallback(() => {
    closeMenus();
    setShowSearchBox(true);
    replaceInputRef.current?.focus();
    replaceInputRef.current?.select();
  }, [closeMenus]);

  const openGoToLine = useCallback(() => {
    closeMenus();
    setGoToLineValue(String(cursorPosition.line));
    setGoToLineOpen(true);
  }, [closeMenus, cursorPosition.line]);

  const moveCursorToLine = useCallback((lineNumber: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    const lines = activePlainText.split(/\r?\n/);
    const safeLine = Math.min(Math.max(lineNumber, 1), Math.max(lines.length, 1));
    let targetIndex = 0;
    for (let i = 0; i < safeLine - 1; i += 1) {
      targetIndex += (lines[i]?.length ?? 0) + 1;
    }

    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            (node as HTMLElement).tagName === "BR"
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_SKIP;
        },
      },
    );

    let walked = 0;
    let foundNode: Node | null = null;
    let foundOffset = 0;
    let current = walker.nextNode();
    while (current) {
      if (current.nodeType === Node.TEXT_NODE) {
        const textLen = current.nodeValue?.length ?? 0;
        if (targetIndex <= walked + textLen) {
          foundNode = current;
          foundOffset = Math.max(0, targetIndex - walked);
          break;
        }
        walked += textLen;
      } else {
        if (targetIndex <= walked) {
          foundNode = current.parentNode;
          const siblings = current.parentNode?.childNodes;
          if (siblings) {
            for (let i = 0; i < siblings.length; i += 1) {
              if (siblings[i] === current) {
                foundOffset = i;
                break;
              }
            }
          }
          break;
        }
        walked += 1;
      }
      current = walker.nextNode();
    }

    if (!foundNode) {
      foundNode = editor;
      foundOffset = editor.childNodes.length;
    }

    const range = document.createRange();
    const selection = window.getSelection();
    try {
      if (foundNode.nodeType === Node.TEXT_NODE) {
        range.setStart(foundNode, foundOffset);
      } else {
        range.setStart(foundNode, Math.max(0, foundOffset));
      }
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      editor.focus();
      updateCursorIndex();
    } catch (error) {
      console.error("Failed to move cursor", error);
    }
  }, [activePlainText, updateCursorIndex]);

  const clampZoom = (value: number) => Math.min(2, Math.max(0.5, value));
  const applyZoom = useCallback((next: number) => {
    setZoomLevel(clampZoom(next));
  }, []);
  const zoomIn = useCallback(() => applyZoom(zoomLevel + 0.1), [applyZoom, zoomLevel]);
  const zoomOut = useCallback(() => applyZoom(zoomLevel - 0.1), [applyZoom, zoomLevel]);
  const resetZoom = useCallback(() => applyZoom(1), [applyZoom]);

  const submitGoToLine = useCallback(() => {
    const parsed = Number.parseInt(goToLineValue, 10);
    if (Number.isNaN(parsed)) return;
    moveCursorToLine(parsed);
    setGoToLineOpen(false);
  }, [goToLineValue, moveCursorToLine]);

  const applySearchHighlights = useCallback(
    (query: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      const trimmed = query.trim();
      if (!trimmed) {
        setSearchMatchCount(0);
        applyEditorHtml(editor, activeHtml);
        return;
      }
      const baseHtml = stripTrustedSearchHighlights(activeHtml);
      const container = document.createElement("div");
      container.innerHTML = baseHtml;
      const regex = new RegExp(escapeRegex(trimmed), "gi");
      let count = 0;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        nodes.push(node as Text);
        node = walker.nextNode();
      }
      nodes.forEach((textNode) => {
        const text = textNode.nodeValue ?? "";
        if (!regex.test(text)) {
          regex.lastIndex = 0;
          return;
        }
        regex.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text))) {
          const start = match.index;
          const end = start + match[0].length;
          if (start > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
          }
          const mark = document.createElement("mark");
          mark.className = "search-hit";
          mark.textContent = text.slice(start, end);
          fragment.appendChild(mark);
          count += 1;
          lastIndex = end;
        }
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
        textNode.parentNode?.replaceChild(fragment, textNode);
      });
      // Search highlights are generated from sanitized DOM and inserted as nodes,
      // avoiding a second raw HTML string sink here.
      editor.replaceChildren(...Array.from(container.childNodes).map((node) => node.cloneNode(true)));
      setSearchMatchCount(count);
      const firstHit = editor.querySelector("mark.search-hit");
      if (firstHit) {
        (firstHit as HTMLElement).scrollIntoView({ block: "center" });
      }
    },
    [activeHtml, applyEditorHtml],
  );

  const replaceMatches = useCallback(
    (mode: "one" | "all") => {
      const trimmed = searchQuery.trim();
      if (!trimmed || !activeTab) return;
      const nextHtml = replaceTextInHtml(activeHtml, trimmed, replaceQuery, mode);
      updateContent(nextHtml);
      window.requestAnimationFrame(() => applySearchHighlights(trimmed));
    },
    [activeHtml, activeTab, applySearchHighlights, replaceQuery, searchQuery, updateContent],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (showSearchBox && searchQuery.trim()) {
      applySearchHighlights(searchQuery);
      return;
    }
    setSearchMatchCount(0);
    applyEditorHtml(editor, activeHtml);
  }, [activeHtml, activeTabId, applyEditorHtml, applySearchHighlights, searchQuery, showSearchBox]);

  const moveTab = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTabs((prev) => {
      const fromIndex = prev.findIndex((t) => t.id === fromId);
      const toIndex = prev.findIndex((t) => t.id === toId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  useEffect(() => {
    if (!draggedTabId) return;
    const clearDraggedTab = () => setDraggedTabId(null);
    window.addEventListener("pointerup", clearDraggedTab);
    window.addEventListener("pointercancel", clearDraggedTab);
    window.addEventListener("blur", clearDraggedTab);
    return () => {
      window.removeEventListener("pointerup", clearDraggedTab);
      window.removeEventListener("pointercancel", clearDraggedTab);
      window.removeEventListener("blur", clearDraggedTab);
    };
  }, [draggedTabId]);

  const minimizeWindow = async () => {
    await windowHandle.minimize();
  };

  const toggleMaximizeWindow = useCallback(async () => {
    const wasMaximized = await syncWindowMaximizedState();
    if (wasMaximized === null) return;
    try {
      if (wasMaximized) {
        await windowHandle.unmaximize();
      } else {
        await windowHandle.maximize();
      }
    } catch (error) {
      console.error("Failed to toggle maximize", error);
      return;
    }

    void window.setTimeout(() => {
      void syncWindowMaximizedState();
    }, 60);
    void window.setTimeout(() => {
      void syncWindowMaximizedState();
    }, 180);
  }, [syncWindowMaximizedState, windowHandle]);

  const handleWindowDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.detail === 2) {
      void toggleMaximizeWindow();
      return;
    }
    void windowHandle.startDragging().catch((error) => {
      console.error("Failed to start dragging window", error);
    });
  }, [toggleMaximizeWindow, windowHandle]);

  const closeWindow = useCallback(async () => {
    if (allowImmediateCloseRef.current) {
      await windowHandle.close();
      return;
    }
    const dirtyTabs = tabs.filter((tab) => isTabDirty(tab));
    if (dirtyTabs.length > 0) {
      closeMenus();
      setWindowClosePromptOpen(true);
      return;
    }
    allowImmediateCloseRef.current = true;
    try {
      await windowHandle.close();
    } finally {
      allowImmediateCloseRef.current = false;
    }
  }, [closeMenus, isTabDirty, tabs, windowHandle]);

  const discardAndCloseWindow = useCallback(async () => {
    setWindowClosePromptOpen(false);
    allowImmediateCloseRef.current = true;
    try {
      await windowHandle.close();
    } finally {
      allowImmediateCloseRef.current = false;
    }
  }, [windowHandle]);

  const saveAndCloseWindow = useCallback(async () => {
    const dirtyTabs = tabs.filter((tab) => isTabDirty(tab));
    setWindowClosePromptOpen(false);
    for (const tab of dirtyTabs) {
      const saved = await saveTab(tab);
      if (!saved) {
        return;
      }
    }
    allowImmediateCloseRef.current = true;
    try {
      await windowHandle.close();
    } finally {
      allowImmediateCloseRef.current = false;
    }
  }, [isTabDirty, saveTab, tabs, windowHandle]);

  const focusAlwaysMemo = useCallback(async () => {
    try {
      if (await windowHandle.isMinimized()) {
        await windowHandle.unminimize();
      }
      await windowHandle.show();
      await windowHandle.setFocus();
      await windowHandle.requestUserAttention(UserAttentionType.Informational);
      restoreEditorSelection();
    } catch (error) {
      console.error("Failed to focus AlwaysMemo", error);
    }
  }, [restoreEditorSelection, windowHandle]);

  const shortcutActions = useMemo(
    () => [
      { id: "focusAlwaysMemo", combo: "Ctrl+Alt+[", action: focusAlwaysMemo },
      { id: "alwaysOnTop", combo: "Ctrl+Alt+T", action: toggleAlwaysOnTop },
      { id: "snapLeft", combo: "Ctrl+Alt+Left", action: snapLeft },
      { id: "snapRight", combo: "Ctrl+Alt+Right", action: snapRight },
      { id: "snapTop", combo: "Ctrl+Alt+Up", action: snapTop },
      { id: "snapBottom", combo: "Ctrl+Alt+Down", action: snapBottom },
      { id: "minimumSize", combo: "Ctrl+Alt+J", action: resizeToMinimum },
      { id: "fitContent", combo: "Ctrl+Alt+K", action: resizeToFitContent },
    ],
    [
      focusAlwaysMemo,
      resizeToFitContent,
      resizeToMinimum,
      snapBottom,
      snapLeft,
      snapRight,
      snapTop,
      toggleAlwaysOnTop,
    ],
  );

  useEffect(() => {
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    void syncWindowMaximizedState();
    void windowHandle.onResized(() => {
      scheduleWindowMaximizedSync();
    }).then((cleanup) => {
      unlistenResize = cleanup;
    }).catch((error) => {
      console.error("Failed to listen for resize", error);
    });
    void windowHandle.onMoved(() => {
      scheduleWindowMaximizedSync();
    }).then((cleanup) => {
      unlistenMove = cleanup;
    }).catch((error) => {
      console.error("Failed to listen for move", error);
    });
    return () => {
      if (windowStateSyncTimerRef.current !== null) {
        window.clearTimeout(windowStateSyncTimerRef.current);
      }
      unlistenResize?.();
      unlistenMove?.();
    };
  }, [scheduleWindowMaximizedSync, syncWindowMaximizedState, windowHandle]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void windowHandle.onCloseRequested(async (event) => {
      if (allowImmediateCloseRef.current) return;
      event.preventDefault();
      await closeWindow();
    }).then((cleanup) => {
      unlisten = cleanup;
    }).catch((error) => {
      console.error("Failed to listen for close requests", error);
    });
    return () => {
      unlisten?.();
    };
  }, [closeWindow, windowHandle]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
        if (event.code === "Tab") {
          event.preventDefault();
          cycleActiveTab(event.shiftKey ? -1 : 1);
          return;
        }
        const key = event.key;
        const noShift = !event.shiftKey;
        if (noShift && (key === "+" || key === "=")) {
          event.preventDefault();
          setZoomLevel((prev) => Math.min(2, Math.max(0.5, prev + 0.1)));
          return;
        }
        if (noShift && event.code === "Semicolon") {
          event.preventDefault();
          setZoomLevel((prev) => Math.min(2, Math.max(0.5, prev + 0.1)));
          return;
        }
        if (noShift && event.code === "NumpadAdd") {
          event.preventDefault();
          setZoomLevel((prev) => Math.min(2, Math.max(0.5, prev + 0.1)));
          return;
        }
        if (noShift && key === "-") {
          event.preventDefault();
          setZoomLevel((prev) => Math.min(2, Math.max(0.5, prev - 0.1)));
          return;
        }
        if (noShift && event.code === "NumpadSubtract") {
          event.preventDefault();
          setZoomLevel((prev) => Math.min(2, Math.max(0.5, prev - 0.1)));
          return;
        }
        if (noShift && key === "0") {
          event.preventDefault();
          setZoomLevel(1);
          return;
        }
        if (noShift && event.code === "Numpad0") {
          event.preventDefault();
          setZoomLevel(1);
          return;
        }
        switch (event.code) {
          case "KeyN": {
            event.preventDefault();
            if (event.shiftKey) {
              void openNewWindow();
              return;
            }
            addTab();
            return;
          }
          case "KeyS": {
            event.preventDefault();
            void saveActiveTab();
            return;
          }
          case "KeyO": {
            event.preventDefault();
            void openFilePicker();
            return;
          }
          case "KeyW": {
            event.preventDefault();
            if (event.shiftKey) {
              void closeWindow();
              return;
            }
            closeActiveTab();
            return;
          }
          default:
            break;
        }
      }
      if (!event.ctrlKey || !event.altKey) return;
      switch (event.code) {
        case "BracketLeft": {
          event.preventDefault();
          void focusAlwaysMemo();
          break;
        }
        case "KeyT": {
          event.preventDefault();
          setStatus(messages.app.statuses.hotkeyToggleAlwaysOnTop);
          void toggleAlwaysOnTop();
          break;
        }
        case "ArrowLeft": {
          event.preventDefault();
          setStatus(messages.app.statuses.hotkeySnapLeft);
          void snapLeft();
          break;
        }
        case "ArrowRight": {
          event.preventDefault();
          setStatus(messages.app.statuses.hotkeySnapRight);
          void snapRight();
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          setStatus(messages.app.statuses.hotkeySnapTop);
          void snapTop();
          break;
        }
        case "ArrowDown": {
          event.preventDefault();
          setStatus(messages.app.statuses.hotkeySnapBottom);
          void snapBottom();
          break;
        }
        case "KeyJ": {
          event.preventDefault();
          void resizeToMinimum();
          break;
        }
        case "KeyK": {
          event.preventDefault();
          void resizeToFitContent();
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    addTab,
    cycleActiveTab,
    closeActiveTab,
    closeWindow,
    focusAlwaysMemo,
    openFilePicker,
    openNewWindow,
    resizeToFitContent,
    resizeToMinimum,
    saveActiveTab,
    snapBottom,
    snapLeft,
    snapRight,
    snapTop,
    messages.app.statuses,
    toggleAlwaysOnTop,
  ]);

  useEffect(() => {
    const registerGlobalShortcuts = async () => {
      const attemptRegister = async () => {
        await Promise.all(
          shortcutActions.map(({ combo, action }) => register(combo, action)),
        );
      };

      try {
        await unregisterAll();
        await attemptRegister();
      } catch (error: unknown) {
        const message = String(error);
        // If dev hot-reload left stale registrations, clear and retry once.
        if (message.includes("already registered")) {
          await unregisterAll();
          await attemptRegister();
        } else {
          setStatus(messages.app.statuses.globalShortcutError(message));
          throw error;
        }
      }
      setStatus(messages.app.statuses.globalShortcutsActive);
    };

    const configure = async () => {
      try {
        const canUseGlobalShortcuts = await ensureGlobalShortcutsSingleWindow();
        if (useGlobalShortcuts && canUseGlobalShortcuts) {
          await registerGlobalShortcuts();
        } else {
          await unregisterAll();
          setStatus(messages.app.statuses.localShortcutsActive);
        }
      } catch (error) {
        console.error(error);
        setStatus(messages.app.statuses.failedConfigureShortcuts);
      }
    };

    void configure();

    return () => {
      void unregisterAll().catch((error) => {
        console.error("Failed to unregister shortcuts", error);
      });
    };
  }, [
    ensureGlobalShortcutsSingleWindow,
    messages.app.statuses,
    setGlobalShortcutsPreference,
    shortcutActions,
    useGlobalShortcuts,
  ]);

  const handleTopTabsWheel = useCallback((event: WheelEvent) => {
    // While pointer is on the top bar, block vertical page/editor scrolling.
    event.preventDefault();
    const scroller = tabsScrollerRef.current;
    if (!scroller) return;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    const maxLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const baseLeft = tabsWheelTargetRef.current ?? scroller.scrollLeft;
    tabsWheelTargetRef.current = Math.max(0, Math.min(maxLeft, baseLeft + delta * 3));
    if (tabsWheelRafRef.current !== null) return;

    const animate = () => {
      const currentScroller = tabsScrollerRef.current;
      const target = tabsWheelTargetRef.current;
      if (!currentScroller || target === null) {
        tabsWheelRafRef.current = null;
        return;
      }
      const diff = target - currentScroller.scrollLeft;
      if (Math.abs(diff) < 0.3) {
        currentScroller.scrollLeft = target;
        tabsWheelRafRef.current = null;
        return;
      }
      currentScroller.scrollLeft += diff * 0.3;
      tabsWheelRafRef.current = window.requestAnimationFrame(animate);
    };

    tabsWheelRafRef.current = window.requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    const topBar = topTitlebarRef.current;
    if (!topBar) return;
    const listener = (event: WheelEvent) => {
      handleTopTabsWheel(event);
    };
    topBar.addEventListener("wheel", listener, { passive: false });
    return () => topBar.removeEventListener("wheel", listener);
  }, [handleTopTabsWheel]);

  useEffect(() => {
    return () => {
      if (tabsWheelRafRef.current !== null) {
        window.cancelAnimationFrame(tabsWheelRafRef.current);
      }
    };
  }, []);

  const getTabLabel = (tab: Tab) => {
    if (!isUntitledTitle(tab.title)) return tab.title;
    const trimmed = trustedHtmlToText(tab.content).trimStart();
    if (!trimmed) return messages.app.untitledTab;
    const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
    const maxLength = 20;
    if (firstLine.length > maxLength) {
      return `${firstLine.slice(0, maxLength)}...`;
    }
    return firstLine || messages.app.untitledTab;
  };

  return (
    <div className={`app theme-${effectiveTheme} ${isWindowMaximized ? "window-maximized" : ""}`}>
      <div className="titlebar">
        <div
          className="titlebar-row top"
          ref={topTitlebarRef}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement;
            if (!target.closest(".tab")) {
              setDraggedTabId(null);
            }
          }}
        >
          <div className="tabs-area">
            <div className="tabs-bar">
              <div
                className="tabs"
                ref={tabsScrollerRef}
                onScroll={() => {
                  const scroller = tabsScrollerRef.current;
                  if (!scroller) return;
                  tabsWheelTargetRef.current = scroller.scrollLeft;
                }}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    data-tab-id={tab.id}
                    className={`tab ${tab.id === activeTabId ? "active" : ""} ${draggedTabId === tab.id ? "dragging" : ""} ${closingTabIds.includes(tab.id) ? "closing" : ""}`}
                    onClick={() => setActiveTabId(tab.id)}
                    onDoubleClick={() => {
                      const next = window.prompt(
                        messages.app.renameTabPrompt,
                        isUntitledTitle(tab.title) ? messages.app.untitledTab : tab.title,
                      );
                      if (next?.trim()) renameTab(tab.id, next.trim());
                    }}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      if (isWindowMaximized) return;
                      setDraggedTabId(tab.id);
                    }}
                    onPointerEnter={(event) => {
                      if (!draggedTabId || draggedTabId === tab.id) return;
                      if ((event.buttons & 1) !== 1) return;
                      moveTab(draggedTabId, tab.id);
                    }}
                  >
                    <span className="tab-title">{getTabLabel(tab)}</span>
                    <span
                      className={`tab-close ${isTabDirty(tab) ? "dirty" : ""}`}
                      onPointerEnter={() => setHoveredTabCloseId(tab.id)}
                      onPointerLeave={() => setHoveredTabCloseId((current) => (current === tab.id ? null : current))}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (closingTabIds.includes(tab.id)) return;
                        void requestRemoveTab(tab.id);
                      }}
                      aria-label={
                        isTabDirty(tab)
                          ? messages.app.tabCloseAria.unsaved
                          : messages.app.tabCloseAria.close
                      }
                    >
                      {isTabDirty(tab) && hoveredTabCloseId !== tab.id ? (
                        <span className="tab-close-icon dirty-indicator" aria-hidden="true">●</span>
                      ) : (
                        <span className="tab-close-icon" aria-hidden="true">
                          <X size={11} strokeWidth={2.2} aria-hidden="true" />
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <button
              className="add-tab"
              onClick={addTab}
              title={messages.app.newTabButtonTitle}
            >
              <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <div
            className="drag-region"
            onPointerDown={handleWindowDragStart}
          />
          <div className="window-controls">
            <button
              type="button"
              className="window-button"
              onClick={minimizeWindow}
              aria-label={messages.common.windowControls.minimize}
            >
              <Minus className="window-icon" strokeWidth={1.2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="window-button"
              onClick={toggleMaximizeWindow}
              aria-label={
                isWindowMaximized
                  ? messages.common.windowControls.restore
                  : messages.common.windowControls.maximize
              }
            >
              {isWindowMaximized ? (
                <Copy className="window-icon" strokeWidth={1.2} aria-hidden="true" />
              ) : (
                <Square className="window-icon" strokeWidth={1.2} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              className="window-button close"
              onClick={closeWindow}
              aria-label={messages.common.windowControls.close}
            >
              <X className="window-icon close-window-icon" strokeWidth={1.2} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="titlebar-row toolbar">
          <>
            <div className="menu-group" ref={menuRef}>
              <div className="menu-wrapper" ref={fileMenuWrapperRef}>
                <button
                  type="button"
                  className={`menu-button file-menu-button ${openMenu === "file" ? "active" : ""}`}
                  onClick={() => setOpenMenu((prev) => (prev === "file" ? null : "file"))}
                >
                  {messages.app.menu.file}
                </button>
                {openMenu === "file" ? (
                  <div
                    className="menu-panel file-menu-panel"
                    ref={fileMenuRef}
                    style={fileMenuStyle}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <button type="button" className="menu-item" onClick={() => { addTab(); closeMenus(); }}>
                      <span>{messages.app.menu.newTab}</span>
                      <span className="menu-shortcut">Ctrl+N</span>
                    </button>
                    <button type="button" className="menu-item" onClick={() => { closeMenus(); void openNewWindow(); }}>
                      <span>{messages.app.menu.newWindow}</span>
                      <span className="menu-shortcut">Ctrl+Shift+N</span>
                    </button>
                    <div className="menu-divider" />
                    <button type="button" className="menu-item" onClick={() => { closeMenus(); void openFilePicker(); }}>
                      <span>{messages.app.menu.open}</span>
                      <span className="menu-shortcut">Ctrl+O</span>
                    </button>
                    <div className="menu-divider" />
                    <button type="button" className="menu-item" onClick={() => { closeMenus(); void saveActiveTab(); }}>
                      <span>{messages.app.menu.save}</span>
                      <span className="menu-shortcut">Ctrl+S</span>
                    </button>
                    <button type="button" className="menu-item" onClick={() => { closeMenus(); void saveActiveTabAs(); }}>
                      <span>{messages.app.menu.saveAs}</span>
                      <span className="menu-shortcut">Ctrl+Shift+S</span>
                    </button>
                    <button type="button" className="menu-item" onClick={() => { closeMenus(); void saveAllTabs(); }}>
                      <span>{messages.app.menu.saveAll}</span>
                      <span className="menu-shortcut">Ctrl+Alt+S</span>
                    </button>
                    <div className="menu-divider" />
                    <button
                      type="button"
                      className="menu-item toggle"
                      onClick={() => {
                        void setAlwaysOnTop(!alwaysOnTop);
                      }}
                    >
                      <span>{messages.app.menu.alwaysOnTop}</span>
                      <span className={`menu-toggle ${alwaysOnTop ? "on" : ""}`} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="menu-item toggle"
                      onClick={() => {
                        void (async () => {
                          const nextValue = !useGlobalShortcuts;
                          if (nextValue) {
                            const canEnable = await ensureGlobalShortcutsSingleWindow();
                            if (!canEnable) return;
                          }
                          setGlobalShortcutsPreference(nextValue, "manual");
                        })();
                      }}
                    >
                      <span>{messages.app.menu.globalShortcuts}</span>
                      <span className={`menu-toggle ${useGlobalShortcuts ? "on" : ""}`} aria-hidden="true" />
                    </button>
                    <div className="menu-divider" />
                    <button type="button" className="menu-item" onClick={() => { closeActiveTab(); closeMenus(); }}>
                      <span>{messages.app.menu.closeTab}</span>
                      <span className="menu-shortcut">Ctrl+W</span>
                    </button>
                    <button type="button" className="menu-item" onClick={() => { closeMenus(); void closeWindow(); }}>
                      <span>{messages.app.menu.closeWindow}</span>
                      <span className="menu-shortcut">Ctrl+Shift+W</span>
                    </button>
                    <button type="button" className="menu-item" onClick={() => { closeMenus(); void closeWindow(); }}>
                      <span>{messages.app.menu.exit}</span>
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="menu-wrapper" ref={editMenuWrapperRef}>
                <button
                  type="button"
                  className={`menu-button ${openMenu === "edit" ? "active" : ""}`}
                  onClick={() => setOpenMenu((prev) => (prev === "edit" ? null : "edit"))}
                >
                  {messages.app.menu.edit}
                </button>
                {openMenu === "edit" ? (
                  <div
                    className="menu-panel"
                    ref={editMenuRef}
                    style={editMenuStyle}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <button type="button" className="menu-item" onClick={() => { runEditorCommand("undo"); closeMenus(); }}>
                      <span>{messages.app.menu.undo}</span>
                      <span className="menu-shortcut">Ctrl+Z</span>
                    </button>
                    <button type="button" className="menu-item" onClick={() => { runEditorCommand("cut"); closeMenus(); }}>
                      <span>{messages.app.menu.cut}</span>
                      <span className="menu-shortcut">Ctrl+X</span>
                    </button>
                    <button type="button" className="menu-item" onClick={() => { runEditorCommand("copy"); closeMenus(); }}>
                      <span>{messages.app.menu.copy}</span>
                      <span className="menu-shortcut">Ctrl+C</span>
                    </button>
                    <button type="button" className="menu-item" onClick={() => { void pasteFromClipboard(); closeMenus(); }}>
                      <span>{messages.app.menu.paste}</span>
                      <span className="menu-shortcut">Ctrl+V</span>
                    </button>
                    <div className="menu-divider" />
                    <button type="button" className="menu-item" onClick={() => { focusSearchBox(); closeMenus(); }}>
                      <span>{messages.app.menu.find}</span>
                      <span className="menu-shortcut">Ctrl+F</span>
                    </button>
                    <button type="button" className="menu-item" onClick={() => { focusReplaceBox(); closeMenus(); }}>
                      <span>{messages.app.menu.replace}</span>
                      <span className="menu-shortcut">Ctrl+H</span>
                    </button>
                    <button type="button" className="menu-item" onClick={openGoToLine}>
                      <span>{messages.app.menu.goTo}</span>
                      <span className="menu-shortcut">Ctrl+G</span>
                    </button>
                    <div className="menu-divider" />
                    <button type="button" className="menu-item disabled" aria-disabled="true">
                      <span>{messages.app.menu.font}</span>
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="menu-wrapper" ref={viewMenuWrapperRef}>
                <button
                  type="button"
                  className={`menu-button ${openMenu === "view" ? "active" : ""}`}
                  onClick={() => setOpenMenu((prev) => (prev === "view" ? null : "view"))}
                >
                  {messages.app.menu.view}
                </button>
                {openMenu === "view" ? (
                  <div
                    className="menu-panel"
                    ref={viewMenuRef}
                    style={viewMenuStyle}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <button type="button" className="menu-item" onClick={zoomIn}>
                      <span>{messages.app.menu.zoomIn}</span>
                      <span className="menu-shortcut">{messages.app.menu.zoomInShortcut}</span>
                    </button>
                    <button type="button" className="menu-item" onClick={zoomOut}>
                      <span>{messages.app.menu.zoomOut}</span>
                      <span className="menu-shortcut">{messages.app.menu.zoomOutShortcut}</span>
                    </button>
                    <button type="button" className="menu-item" onClick={resetZoom}>
                      <span>{messages.app.menu.resetZoom}</span>
                      <span className="menu-shortcut">Ctrl+0</span>
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => setShowStatusBar((prev) => !prev)}
                    >
                      <span className={`menu-check ${showStatusBar ? "on" : ""}`}>✓</span>
                      <span>{messages.app.menu.statusBar}</span>
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={() => setWrapAtRightEdge((prev) => !prev)}
                    >
                      <span className={`menu-check ${wrapAtRightEdge ? "on" : ""}`}>✓</span>
                      <span>{messages.app.menu.wrapAtRightEdge}</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            {showSearchBox ? (
              <div className="search-group">
                <div className="search-bar">
                  <span className="search-icon">
                    <Search size={12} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <input
                    ref={searchInputRef}
                    type="search"
                    className="search-input"
                    placeholder={messages.app.search.searchPlaceholder}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        applySearchHighlights(event.currentTarget.value);
                      }
                      if (event.key === "Escape") {
                        setShowSearchBox(false);
                      }
                    }}
                  />
                  {searchQuery.trim() ? (
                    <span className="search-count">{messages.app.search.count(searchMatchCount)}</span>
                  ) : null}
                  <button
                    type="button"
                    className="search-close"
                    onClick={() => setShowSearchBox(false)}
                    aria-label={messages.app.search.close}
                  >
                    <X size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                <div className="search-bar">
                  <span className="search-icon">
                    <RefreshCw size={12} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <input
                    ref={replaceInputRef}
                    type="text"
                    className="search-input"
                    placeholder={messages.app.search.replacePlaceholder}
                    value={replaceQuery}
                    onChange={(event) => setReplaceQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        replaceMatches("one");
                      }
                      if (event.key === "Escape") {
                        setShowSearchBox(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="search-action"
                    onClick={() => replaceMatches("one")}
                  >
                    {messages.app.search.replace}
                  </button>
                  <button
                    type="button"
                    className="search-action"
                    onClick={() => replaceMatches("all")}
                  >
                    {messages.app.search.replaceAll}
                  </button>
                </div>
              </div>
            ) : null}
            <div className="right-group">
              <div className="help-panel-wrap">
                <button
                  ref={helpButtonRef}
                  type="button"
                  className={`icon-button ${helpPanelOpen ? "active" : ""}`}
                  aria-label={messages.app.help.buttonLabel}
                  aria-expanded={helpPanelOpen}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setOpenMenu(null);
                    if (helpHintVisible) {
                      dismissHelpHint();
                    }
                    setHelpPanelOpen((prev) => !prev);
                  }}
                >
                  <CircleQuestionMark size={14} strokeWidth={1.9} aria-hidden="true" />
                </button>
                {helpHintVisible && !helpPanelOpen ? (
                  <div
                    ref={helpHintRef}
                    className="help-hint-bubble"
                    role="note"
                    aria-label={messages.app.help.hintLabel}
                  >
                    <button
                      type="button"
                      className="help-hint-close"
                      aria-label={messages.app.help.closeHint}
                      onClick={dismissHelpHint}
                    >
                      <X size={12} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <p>{messages.app.help.hintBody}</p>
                  </div>
                ) : null}
                {helpPanelOpen ? (
                  <div
                    ref={helpPanelRef}
                    className="help-panel"
                    role="dialog"
                    aria-modal="false"
                    aria-label={messages.app.help.panelLabel}
                  >
                    <div className="help-panel-header">
                      <strong>{messages.app.help.title}</strong>
                      <button
                        type="button"
                        className="help-panel-close"
                        aria-label={messages.app.help.closePanel}
                        onClick={() => {
                          setHelpPanelOpen(false);
                          helpButtonRef.current?.focus();
                        }}
                      >
                        <X size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>

                    <section className="help-panel-section" aria-labelledby="mini-help-shortcuts-title">
                      <h3 id="mini-help-shortcuts-title">{messages.app.help.shortcutsTitle}</h3>
                      <div className="help-shortcuts-list">
                        {messages.app.help.shortcuts.map((item) => (
                          <div
                            key={`${"groups" in item ? item.groups.flat().join("-") : item.keys.join("-")}-${item.label}`}
                            className="help-shortcut-row"
                          >
                            {"groups" in item ? (
                              <div className="help-shortcut-groups" aria-hidden="true">
                                {item.groups.map((group, groupIndex) => (
                                  <div key={`${item.label}-${groupIndex}`} className="help-shortcut-group">
                                    {groupIndex > 0 ? <span className="help-plus">+</span> : null}
                                    <div className="help-shortcut-keys">
                                      {group.map((key) => (
                                        <kbd key={`${item.label}-${key}`} className="help-keycap">
                                          {key}
                                        </kbd>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="help-shortcut-keys" aria-hidden="true">
                                {item.keys.map((key, index) => (
                                  <span key={`${item.label}-${key}`}>
                                    {index > 0 ? <span className="help-plus">+</span> : null}
                                    <kbd className="help-keycap">{key}</kbd>
                                  </span>
                                ))}
                              </div>
                            )}
                            <span className="help-shortcut-label">{item.label}</span>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="help-panel-section" aria-labelledby="mini-help-points-title">
                      <h3 id="mini-help-points-title">{messages.app.help.pointsTitle}</h3>
                      <ul className="help-points-list">
                        {messages.app.help.points.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>

                    <button
                      type="button"
                      className="help-link-button"
                      onClick={() => {
                        void openDetailedHelp();
                      }}
                    >
                      <span>{messages.app.help.openDetailedHelp}</span>
                      <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={messages.app.settingsButtonLabel}
                onClick={() => {
                  void openSettingsWindow();
                }}
              >
                <Settings size={14} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </div>
          </>
        </div>
      </div>

      <section className="card memo" style={{ zoom: zoomLevel }}>
        <div className="editor">
          <div className="editor-header">
          </div>

          <div
            ref={editorRef}
            className="editor-body"
            data-wrap={wrapAtRightEdge ? "on" : "off"}
            data-line-spacing={lineSpacing}
            style={{
              fontSize: `${editorFontSizePx}px`,
              lineHeight: editorLineHeight,
              ["--editor-block-gap" as string]: `${editorBlockGapPx}px`,
            }}
            contentEditable
            suppressContentEditableWarning
            data-placeholder={messages.app.editorPlaceholder}
            onInput={(event) => {
              updateContent(event.currentTarget.innerHTML);
              scheduleCursorIndexUpdate();
            }}
            onPaste={handleEditorPaste}
            onDrop={handleEditorDrop}
            onDragOver={(event) => event.preventDefault()}
            onKeyUp={scheduleCursorIndexUpdate}
            onMouseUp={scheduleCursorIndexUpdate}
            onClick={scheduleCursorIndexUpdate}
          />
        </div>
      </section>

      {windowClosePromptOpen ? (
        <div className="format-choice-overlay" role="presentation">
          <div
            className="delete-choice-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="window-close-title"
            aria-describedby="window-close-desc"
          >
            <h2 id="window-close-title">{messages.app.dialogs.confirmTitle}</h2>
            <p id="window-close-desc">
              {messages.app.dialogs.unsavedMemosBeforeExit(dirtyTabCount)}
            </p>
            <div className="delete-choice-actions">
              <button
                type="button"
                className="delete-choice primary"
                onClick={() => {
                  void saveAndCloseWindow();
                }}
              >
                {messages.app.dialogs.save}
              </button>
              <button
                type="button"
                className="delete-choice"
                onClick={() => {
                  void discardAndCloseWindow();
                }}
              >
                {messages.app.dialogs.dontSave}
              </button>
              <button
                type="button"
                className="delete-choice ghost"
                onClick={() => setWindowClosePromptOpen(false)}
              >
                {messages.app.dialogs.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deletePromptTab ? (
        <div className="format-choice-overlay" role="presentation">
          <div
            className="delete-choice-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-choice-title"
            aria-describedby="delete-choice-desc"
          >
            <h2 id="delete-choice-title">{messages.app.dialogs.confirmTitle}</h2>
            <p id="delete-choice-desc">
              {messages.app.dialogs.saveChangesTo(deletePromptTab.filePath ?? deletePromptTab.title)}
            </p>
            <div className="delete-choice-actions">
              <button
                type="button"
                className="delete-choice primary"
                onClick={() => {
                  const tab = deletePromptTab;
                  if (!tab) return;
                  void (async () => {
                    const saved = await saveTab(tab);
                    if (saved) {
                      setDeletePromptTabId(null);
                      closeTabWithAnimation(tab.id);
                    }
                  })();
                }}
              >
                {messages.app.dialogs.save}
              </button>
              <button
                type="button"
                className="delete-choice"
                onClick={() => {
                  closeTabWithAnimation(deletePromptTab.id);
                  setDeletePromptTabId(null);
                }}
              >
                {messages.app.dialogs.dontSave}
              </button>
              <button
                type="button"
                className="delete-choice ghost"
                onClick={() => setDeletePromptTabId(null)}
              >
                {messages.app.dialogs.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {goToLineOpen ? (
        <div className="format-choice-overlay" role="presentation">
          <div
            className="goto-line-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="goto-line-title"
          >
            <h2 id="goto-line-title">{messages.app.dialogs.goToLineTitle}</h2>
            <label htmlFor="goto-line-input">{messages.app.dialogs.lineNumber}</label>
            <input
              ref={goToLineInputRef}
              id="goto-line-input"
              name="goto-line"
              className="goto-line-input"
              type="number"
              min={1}
              value={goToLineValue}
              onChange={(event) => setGoToLineValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitGoToLine();
                if (event.key === "Escape") setGoToLineOpen(false);
              }}
            />
            <div className="goto-line-actions">
              <button type="button" className="goto-line-button primary" onClick={submitGoToLine}>
                {messages.app.dialogs.move}
              </button>
              <button
                type="button"
                className="goto-line-button"
                onClick={() => setGoToLineOpen(false)}
              >
                {messages.app.dialogs.cancel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showStatusBar ? (
        <div className="bottom-bar">
          <span className="bottom-item">
            {messages.app.statusBar.lineColumn(cursorPosition.line, cursorPosition.column)}
          </span>
          <span className="bottom-item">{messages.app.statusBar.characters(activePlainText.length)}</span>
          <span className="bottom-item">{zoomPercentLabel}</span>
          <span className="bottom-item">{messages.app.statusBar.encoding}</span>
          <span className="bottom-item status-item">
            <span className="bottom-label">{messages.app.statusBar.alwaysOnTop}: </span>
            <span className="bottom-value">{alwaysOnTop ? messages.common.on : messages.common.off}</span>
          </span>
          <span className="bottom-item status-item">
            <span className="bottom-label">{messages.app.statusBar.shortcuts}: </span>
            <span className="bottom-value">{useGlobalShortcuts ? messages.common.on : messages.common.off}</span>
          </span>
        </div>
      ) : null}

    </div>
  );
}

export default App;
