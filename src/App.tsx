import {
  type PointerEvent as ReactPointerEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DOMPurify from "dompurify";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  monitorFromPoint,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import {
  ArrowLeft,
  Copy,
  Minus,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Square,
  Sun,
  X,
} from "lucide-react";
import "./App.css";

const MIN_WINDOW_WIDTH = 300;
const MIN_WINDOW_HEIGHT = 200;
const SETTINGS_MIN_WINDOW_WIDTH = 571;
const SETTINGS_MIN_WINDOW_HEIGHT = 410;
const STATE_PERSIST_DEBOUNCE_MS = 300;
const STORAGE_KEY = "alwaysmemo-state";
const TAB_CLOSE_ANIMATION_MS = 140;
const FILE_PATH_PATTERN = /\.(txt|md|markdown)$/i;

type Tab = {
  id: string;
  title: string;
  content: string;
  filePath?: string | null;
};

const DEFAULT_TITLE_REGEX = /^タイトルなし$/;

type SnapPosition = "left" | "right" | null;
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
  sessionBehavior?: SessionBehavior;
  fileOpenBehavior?: FileOpenBehavior;
  editorFontSizePx?: number;
  lineSpacing?: LineSpacing;
  themeMode?: ThemeMode;
};

type SavedWindowBounds = {
  size: PhysicalSize;
  position: PhysicalPosition;
};

type RecentClosedFile = {
  path: string;
  title: string;
  closedAt: number;
};
const MAX_RECENT_CLOSED_FILES = 7;

const BLOCK_TEXT_TAGS = new Set([
  "DIV",
  "P",
  "LI",
  "TR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "TABLE",
]);

const ALLOWED_EDITOR_TAGS = [
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "b",
  "u",
  "ul",
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeEditorHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ALLOWED_EDITOR_TAGS,
    ALLOWED_ATTR: [],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["class", "style"],
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
  });
  const container = document.createElement("div");
  container.innerHTML = typeof sanitized === "string" ? sanitized : String(sanitized);
  container.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "class" || name === "style") {
        element.removeAttribute(attribute.name);
      }
    });
  });
  return container.innerHTML;
}

function replaceTextInHtml(
  html: string,
  query: string,
  replacement: string,
  mode: "one" | "all",
): string {
  const trimmed = query.trim();
  if (!trimmed) return sanitizeEditorHtml(html);

  const container = document.createElement("div");
  container.innerHTML = sanitizeEditorHtml(html);
  const regex = new RegExp(escapeRegex(trimmed), mode === "all" ? "gi" : "i");
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of nodes) {
    const text = textNode.nodeValue ?? "";
    if (!regex.test(text)) {
      regex.lastIndex = 0;
      continue;
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
      fragment.appendChild(document.createTextNode(replacement));
      lastIndex = end;
      if (mode === "one") break;
    }
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(fragment, textNode);
    if (mode === "one") break;
  }

  return sanitizeEditorHtml(container.innerHTML);
}

function nodeToPlainText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return "";
  }

  if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "BR") {
    return "\n";
  }

  let text = "";
  node.childNodes.forEach((child) => {
    text += nodeToPlainText(child);
  });

  if (
    node.nodeType === Node.ELEMENT_NODE &&
    BLOCK_TEXT_TAGS.has((node as Element).tagName) &&
    !text.endsWith("\n")
  ) {
    text += "\n";
  }

  return text;
}

function App() {
  const [useGlobalShortcuts, setUseGlobalShortcuts] = useState(true);
  const [alwaysOnTop, setAlwaysOnTopState] = useState(false);
  const [, setStatus] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "initial", title: "タイトルなし", content: "" },
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
  const [openFileSubmenu, setOpenFileSubmenu] = useState<"recent" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const fileRecentSubmenuRef = useRef<HTMLDivElement | null>(null);
  const editMenuRef = useRef<HTMLDivElement | null>(null);
  const editMenuWrapperRef = useRef<HTMLDivElement | null>(null);
  const [editMenuLeft, setEditMenuLeft] = useState<number | null>(null);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const viewMenuWrapperRef = useRef<HTMLDivElement | null>(null);
  const [viewMenuLeft, setViewMenuLeft] = useState<number | null>(null);
  const settingsContentRef = useRef<HTMLDivElement | null>(null);
  const originalWindowSizeRef = useRef<LogicalSize | null>(null);
  const settingsWindowBoundsRef = useRef<SavedWindowBounds | null>(null);
  const expandedWindowRef = useRef(false);
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [wrapAtRightEdge, setWrapAtRightEdge] = useState(true);
  const [editorFontSizePx, setEditorFontSizePx] = useState(14);
  const [editorFontSizeInput, setEditorFontSizeInput] = useState("14");
  const [lineSpacing, setLineSpacing] = useState<LineSpacing>("standard");
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [sessionBehavior, setSessionBehavior] = useState<SessionBehavior>("restore");
  const [fileOpenBehavior, setFileOpenBehavior] = useState<FileOpenBehavior>("existing");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsNav, setSettingsNav] = useState<"appearance" | "formatting" | "features" | "startup" | "about">("appearance");
  const [deletePromptTabId, setDeletePromptTabId] = useState<string | null>(null);
  const [windowClosePromptOpen, setWindowClosePromptOpen] = useState(false);
  const [closingTabIds, setClosingTabIds] = useState<string[]>([]);
  const [hoveredTabCloseId, setHoveredTabCloseId] = useState<string | null>(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const tabCloseTimerRef = useRef<Record<string, number>>({});
  const settingsReadyRef = useRef(false);
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
  const [recentClosedFiles, setRecentClosedFiles] = useState<RecentClosedFile[]>([]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const deletePromptTab =
    deletePromptTabId ? tabs.find((tab) => tab.id === deletePromptTabId) ?? null : null;
  const modalMinSizeActive = settingsOpen || windowClosePromptOpen || deletePromptTab !== null;
  const windowHandle = getCurrentWindow();
  const effectiveTheme = useMemo(
    () => (themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode),
    [systemPrefersDark, themeMode],
  );

  const syncWindowMaximizedState = useCallback(async () => {
    try {
      setIsWindowMaximized(await windowHandle.isMaximized());
    } catch (error) {
      console.error("Failed to sync maximized state", error);
    }
  }, [windowHandle]);

  const handleWindowDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    void windowHandle.startDragging().catch((error) => {
      console.error("Failed to start dragging window", error);
    });
  }, [windowHandle]);

  const jumpToSettingsSection = useCallback((key: "appearance" | "formatting" | "features" | "startup" | "about") => {
    setSettingsNav(key);
    const container = settingsContentRef.current;
    const target = document.getElementById(`settings-${key}`);
    if (!container || !target) return;
    const rawTop =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      8;
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const top = Math.max(0, Math.min(rawTop, maxTop));
    container.scrollTo({ top, behavior: "smooth" });
  }, []);

  const commitEditorFontSize = useCallback(
    (raw: string) => {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isNaN(parsed)) {
        setEditorFontSizeInput(String(editorFontSizePx));
        return;
      }
      const clamped = Math.max(8, Math.min(72, parsed));
      setEditorFontSizePx(clamped);
      setEditorFontSizeInput(String(clamped));
    },
    [editorFontSizePx],
  );

  useEffect(() => {
    setEditorFontSizeInput(String(editorFontSizePx));
  }, [editorFontSizePx]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
    if (!activeTabId) return;
    tabHistoryRef.current = [...tabHistoryRef.current.filter((id) => id !== activeTabId), activeTabId].slice(-100);
  }, [activeTabId]);
  const activeHtml = activeTab?.content ?? "";
  const sanitizedActiveHtml = useMemo(() => sanitizeEditorHtml(activeHtml), [activeHtml]);
  const activePlainText = useMemo(() => {
    const div = document.createElement("div");
    div.innerHTML = sanitizedActiveHtml;
    return nodeToPlainText(div).replace(/\u00a0/g, " ");
  }, [sanitizedActiveHtml]);
  const storageKey = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const instance = params.get("instance");
    return instance ? `${STORAGE_KEY}-${instance}` : STORAGE_KEY;
  }, []);
  const recentClosedKey = useMemo(() => `${storageKey}-recent-closed`, [storageKey]);
  const lineEndingLabel = useMemo(() => {
    if (activePlainText.includes("\r\n")) return "Windows (CRLF)";
    return "LF";
  }, [activePlainText]);
  const zoomPercentLabel = useMemo(() => `${Math.round(zoomLevel * 100)}%`, [zoomLevel]);
  const previewFontSizePx = useMemo(() => {
    const parsed = Number.parseInt(editorFontSizeInput, 10);
    if (Number.isNaN(parsed)) return editorFontSizePx;
    return Math.max(8, Math.min(72, parsed));
  }, [editorFontSizeInput, editorFontSizePx]);
  const previewLineHeight = useMemo(
    () => (lineSpacing === "relaxed" ? 1.45 : 1.15),
    [lineSpacing],
  );
  const editorLineHeight = useMemo(
    () => (lineSpacing === "relaxed" ? 1.75 : 1.15),
    [lineSpacing],
  );
  const editorBlockGapPx = useMemo(
    () => (lineSpacing === "relaxed" ? 6 : 2),
    [lineSpacing],
  );

  const applyEditorHtml = useCallback((editor: HTMLDivElement, html: string) => {
    // Last-line defense before HTML reaches the live DOM.
    const safeHtml = sanitizeEditorHtml(html);
    if (editor.innerHTML !== safeHtml) {
      editor.innerHTML = safeHtml;
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
    const preRange = range.cloneRange();
    preRange.selectNodeContents(editor);
    preRange.setEnd(range.startContainer, range.startOffset);
    const fragment = preRange.cloneContents();
    const beforeText = nodeToPlainText(fragment)
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n");
    const normalized = beforeText.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const currentLine = Math.max(lines.length, 1);
    const editorText = (editor.innerText ?? "").replace(/\u00a0/g, " ").replace(/\r\n/g, "\n");
    const editorLines = editorText.split("\n");
    const charsBeforeCurrentLine = editorLines
      .slice(0, Math.max(0, currentLine - 1))
      .reduce((total, lineText) => total + lineText.length, 0);
    const caretCharsNoBreak = preRange
      .toString()
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/\n/g, "").length;
    setCursorPosition({
      line: currentLine,
      column: Math.max(1, caretCharsNoBreak - charsBeforeCurrentLine + 1),
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
        sessionBehavior,
        fileOpenBehavior,
        editorFontSizePx,
        lineSpacing,
        themeMode,
      };
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    },
    [activeTabId, alwaysOnTop, editorFontSizePx, fileOpenBehavior, lineSpacing, sessionBehavior, snap, storageKey, themeMode, useGlobalShortcuts],
  );

  const closeMenus = useCallback(() => {
    setOpenMenu(null);
    setOpenFileSubmenu(null);
  }, []);
  const textToHtml = useCallback((text: string) => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, "<br>");
  }, []);

  const normalizeHtml = useCallback(
    (content: string) => {
      const safeContent = /<[^>]+>/.test(content) ? content : textToHtml(content);
      // Any HTML restored from storage or file-open flows is sanitized before use.
      return sanitizeEditorHtml(safeContent);
    },
    [textToHtml],
  );

  const htmlToText = useCallback((html: string) => {
    const div = document.createElement("div");
    div.innerHTML = sanitizeEditorHtml(html);
    return nodeToPlainText(div).replace(/\u00a0/g, " ");
  }, []);

  const stripSearchHighlights = useCallback((html: string) => {
    const container = document.createElement("div");
    container.innerHTML = sanitizeEditorHtml(html);
    container.querySelectorAll("mark.search-hit").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });
    return sanitizeEditorHtml(container.innerHTML);
  }, []);

  const pickSavePath = useCallback(async (suggested: string) => {
    const withExt = suggested.includes(".") ? suggested : `${suggested}.txt`;
    const defaultPath = withExt;
    let resolvedPath: string | null = null;
    let dialogFailed = false;
    const filters = [{ name: "Text", extensions: ["txt", "md", "markdown"] }];
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
    return FILE_PATH_PATTERN.test(resolvedPath) ? resolvedPath : `${resolvedPath}.txt`;
  }, []);

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

  const clearRecentClosedFiles = useCallback(() => {
    setRecentClosedFiles([]);
    window.localStorage.setItem(recentClosedKey, JSON.stringify([]));
  }, [recentClosedKey]);

  const openRecentClosedFile = useCallback(async (path: string) => {
    const existing = tabs.find((tab) => tab.filePath === path);
    if (existing) {
      setActiveTabId(existing.id);
      closeMenus();
      return;
    }
    try {
      const opened = await invoke<{ path: string; contents: string } | null>(
        "open_text_file_by_path",
        { path },
      );
      if (!opened) {
        setRecentClosedFiles((prev) => {
          const next = prev.filter((item) => item.path !== path);
          window.localStorage.setItem(recentClosedKey, JSON.stringify(next));
          return next;
        });
        setStatus("ファイルが見つかりませんでした");
        return;
      }
      const id = crypto.randomUUID();
      const title = getFileNameFromPath(opened.path);
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
      setStatus(`Opened ${title}`);
      closeMenus();
    } catch (error) {
      console.error(error);
      setStatus("Failed to open recent file");
    }
  }, [closeMenus, getFileNameFromPath, getPathMap, persistState, recentClosedKey, setPathMap, tabs, textToHtml]);

  const openFilePicker = useCallback(async () => {
    try {
      const opened = await invoke<{ path: string; contents: string } | null>(
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
          title: "alwaysmemo",
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
          setStatus("Failed to open new window");
        });
        closeMenus();
        return;
      }
      const id = crypto.randomUUID();
      const title = getFileNameFromPath(opened.path) || `メモ ${tabs.length + 1}`;
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
      setStatus(`Opened ${title}`);
      closeMenus();
    } catch (error) {
      console.error(error);
      setStatus("Failed to open file");
    }
  }, [alwaysOnTop, closeMenus, fileOpenBehavior, getPathMap, persistState, setPathMap, tabs, textToHtml, windowHandle]);

  const saveTabAs = useCallback(async (tab: Tab) => {
    try {
      setStatus("Opening save dialog...");
      const suggested = tab.title.trim() || "memo";
      const resolvedPath = await pickSavePath(suggested);
      if (!resolvedPath) {
        setStatus("Save dialog returned no path");
        return false;
      }
      setStatus(`Saving to ${resolvedPath}...`);
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
      setStatus(`Saved ${nextTitle}`);
      closeMenus();
      return true;
    } catch (error) {
      console.error(error);
      setStatus(`Failed to save file: ${String(error)}`);
      return false;
    }
  }, [
    closeMenus,
    getFileNameFromPath,
    htmlToText,
    getPathMap,
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
      setStatus(`Saving to ${resolvedPath}...`);
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
      setStatus(`Saved ${tab.title}`);
      closeMenus();
      return true;
    } catch (error) {
      console.error(error);
      setStatus(`Failed to save file: ${String(error)}`);
      return false;
    }
  }, [
    closeMenus,
    htmlToText,
    getPathMap,
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
      setStatus("No saved files to update");
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
      setStatus("Saved all");
      closeMenus();
    } catch (error) {
      console.error(error);
      setStatus("Failed to save all");
    }
  }, [closeMenus, htmlToText, persistState, tabs]);

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
        title: "alwaysmemo",
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
        setStatus("Failed to open new window");
      });
      closeMenus();
    } catch (error) {
      console.error(error);
      setStatus("Failed to open new window");
    }
  }, [alwaysOnTop, closeMenus, windowHandle]);

  const setAlwaysOnTop = useCallback(
    async (value: boolean) => {
      try {
        const confirmed = await invoke<boolean>("set_always_on_top", { value });
        setAlwaysOnTopState(confirmed);
        setStatus(confirmed ? "Always on top enabled" : "Always on top disabled");
      } catch (error) {
        console.error(error);
        setStatus("Failed to set always on top");
      }
    },
    [],
  );

  const keepSettingsViewport = useCallback(
    (anchor: HTMLElement | null, runner: () => void | Promise<void>) => {
      const container = settingsContentRef.current;
      if (!container) {
        void runner();
        return;
      }
      const beforeTop = anchor?.getBoundingClientRect().top ?? null;
      void Promise.resolve(runner()).finally(() => {
        window.requestAnimationFrame(() => {
          const current = settingsContentRef.current;
          if (!current) return;
          if (anchor && beforeTop !== null) {
            const afterTop = anchor.getBoundingClientRect().top;
            current.scrollTop += afterTop - beforeTop;
          }
          const maxTop = Math.max(0, current.scrollHeight - current.clientHeight);
          current.scrollTop = Math.max(0, Math.min(current.scrollTop, maxTop));
        });
      });
    },
    [],
  );

  const toggleAlwaysOnTop = useCallback(async () => {
    const now = performance.now();
    if (now - toggleLockRef.current < 300) return;
    toggleLockRef.current = now;
    try {
      const next = await invoke<boolean>("toggle_always_on_top");
      setAlwaysOnTopState(next);
      setStatus(next ? "Always on top enabled" : "Always on top disabled");
    } catch (error) {
      console.error(error);
      setStatus("Failed to toggle always on top");
    }
  }, []);

  const snapLeft = useCallback(async () => {
    try {
      await invoke("snap_left");
      setSnap("left");
      setStatus("Snapped to top-left (hotkey)");
    } catch (error) {
      console.error(error);
      setStatus("Failed to snap left");
    }
  }, []);

  const snapRight = useCallback(async () => {
    try {
      await invoke("snap_right");
      setSnap("right");
      setStatus("Snapped to top-right (hotkey)");
    } catch (error) {
      console.error(error);
      setStatus("Failed to snap right");
    }
  }, []);

  const resizeToMinimum = useCallback(async () => {
    try {
      await windowHandle.setSize(new LogicalSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT));
      setStatus("Hotkey: resize to minimum");
    } catch (error) {
      console.error(error);
      setStatus("Failed to resize to minimum");
    }
  }, [windowHandle]);

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
      setStatus("Hotkey: resize to fit content");
    } catch (error) {
      console.error(error);
      setStatus("Failed to resize to fit content");
    }
  }, [windowHandle]);

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
          setSessionBehavior(nextSessionBehavior);
          setFileOpenBehavior(nextFileOpenBehavior);
          setEditorFontSizePx(nextEditorFontSizePx);
          setLineSpacing(nextLineSpacing);
          setThemeMode(nextThemeMode);
          const pathMap = getPathMap();
          const shouldRestoreTabs = nextSessionBehavior === "restore";
          const restoredTabs = ((shouldRestoreTabs && parsed.tabs.length)
            ? parsed.tabs
            : [{ id: "initial", title: "タイトルなし", content: "" }]
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
          setUseGlobalShortcuts(parsed.useGlobalShortcuts ?? true);
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
          }
        } else {
          setSessionBehavior("restore");
          setFileOpenBehavior("existing");
          setEditorFontSizePx(14);
          setLineSpacing("standard");
          setThemeMode("system");
          const nextAlwaysOnTop = forceAlwaysOnTopDefined
            ? forceAlwaysOnTop
            : current;
          setAlwaysOnTopState(nextAlwaysOnTop);
          if (nextAlwaysOnTop) {
            await invoke("set_always_on_top", { value: true });
          }
          savedTabsRef.current = {
            initial: { title: "タイトルなし", content: "" },
          };
        }
        if (openPathParam) {
          try {
            const decodedPath = decodeURIComponent(openPathParam);
            const opened = await invoke<{ path: string; contents: string } | null>(
              "open_text_file_by_path",
              { path: decodedPath },
            );
            if (opened) {
              const id = crypto.randomUUID();
              const title = getFileNameFromPath(opened.path) || "タイトルなし";
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
            }
          } catch (error) {
            console.error("Failed to open startup path", error);
          }
        }
      } catch (error) {
        console.error(error);
        setStatus("Failed to read always on top state");
      } finally {
        settingsReadyRef.current = true;
      }
    };
    void initState();
  }, []);

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
    const root = document.documentElement;
    const dark = effectiveTheme === "dark";
    root.classList.toggle("global-dark", dark);
    return () => {
      root.classList.remove("global-dark");
    };
  }, [effectiveTheme]);

  useEffect(() => {
    let cancelled = false;

    const syncGuardedWindowSize = async () => {
      try {
        if (modalMinSizeActive) {
          const currentSize = await windowHandle.outerSize();
          const currentPosition = await windowHandle.outerPosition();

          if (!settingsWindowBoundsRef.current) {
            settingsWindowBoundsRef.current = {
              size: new PhysicalSize(currentSize),
              position: new PhysicalPosition(currentPosition),
            };
          }

          await windowHandle.setMinSize(
            new LogicalSize(SETTINGS_MIN_WINDOW_WIDTH, SETTINGS_MIN_WINDOW_HEIGHT),
          );

          const probeX = currentPosition.x + Math.max(currentSize.width - 1, 0);
          const probeY = currentPosition.y + Math.floor(currentSize.height / 2);
          const monitor =
            (await monitorFromPoint(probeX, probeY)) ??
            (await currentMonitor());
          const scaleFactor = monitor?.scaleFactor ?? window.devicePixelRatio ?? 1;
          const settingsMinPhysical = new LogicalSize(
            SETTINGS_MIN_WINDOW_WIDTH,
            SETTINGS_MIN_WINDOW_HEIGHT,
          ).toPhysical(scaleFactor);

          const nextWidth = Math.max(currentSize.width, settingsMinPhysical.width);
          const nextHeight = Math.max(currentSize.height, settingsMinPhysical.height);
          const needsResize = nextWidth !== currentSize.width || nextHeight !== currentSize.height;
          if (!cancelled && needsResize) {
            const workArea = monitor?.workArea;
            if (workArea && nextWidth > currentSize.width) {
              const currentRight = currentPosition.x + currentSize.width;
              const workAreaRight = workArea.position.x + workArea.size.width;
              const edgeThreshold = Math.max(8, Math.round(scaleFactor * 8));
              if (Math.abs(workAreaRight - currentRight) <= edgeThreshold) {
                const nextX = Math.max(workArea.position.x, currentRight - nextWidth);
                await windowHandle.setPosition(new PhysicalPosition(nextX, currentPosition.y));
              }
            }

            await windowHandle.setSize(new PhysicalSize(nextWidth, nextHeight));
          }
          return;
        }

        await windowHandle.setMinSize(
          new LogicalSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
        );

        const previousBounds = settingsWindowBoundsRef.current;
        settingsWindowBoundsRef.current = null;
        if (!previousBounds || cancelled) return;

        const currentSize = await windowHandle.outerSize();
        const currentPosition = await windowHandle.outerPosition();

        if (
          previousBounds.size.width !== currentSize.width ||
          previousBounds.size.height !== currentSize.height
        ) {
          await windowHandle.setSize(previousBounds.size);
        }

        if (
          previousBounds.position.x !== currentPosition.x ||
          previousBounds.position.y !== currentPosition.y
        ) {
          await windowHandle.setPosition(previousBounds.position);
        }
      } catch (error) {
          console.error("Failed to sync guarded window size", error);
      }
    };

    void syncGuardedWindowSize();
    return () => {
      cancelled = true;
    };
  }, [modalMinSizeActive, windowHandle]);

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
      setOpenFileSubmenu(null);
    }
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
    if (!goToLineOpen) return;
    window.requestAnimationFrame(() => {
      goToLineInputRef.current?.focus();
      goToLineInputRef.current?.select();
    });
  }, [goToLineOpen]);

  useEffect(() => {
    const hasPopupOpen = openMenu !== null;
    if (!hasPopupOpen) {
      if (expandedWindowRef.current && originalWindowSizeRef.current) {
        void windowHandle.setSize(originalWindowSizeRef.current);
        expandedWindowRef.current = false;
        originalWindowSizeRef.current = null;
      }
      return;
    }

    const frame = window.requestAnimationFrame(async () => {
      const panel =
        openMenu === "file"
          ? fileMenuRef.current
          : openMenu === "edit"
            ? editMenuRef.current
            : viewMenuRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const activeSubmenu =
        openMenu === "file" && openFileSubmenu === "recent"
          ? fileRecentSubmenuRef.current
          : null;
      const subRect = activeSubmenu?.getBoundingClientRect() ?? rect;
      const panelBottom = Math.max(rect.bottom, subRect.bottom);
      const panelNeededBottom = Math.max(
        panelBottom,
        rect.top + Math.max(panel.scrollHeight, rect.height),
      );
      const overflowCss = panelNeededBottom - window.innerHeight;
      const allowHorizontalExpand = openMenu === "file" && openFileSubmenu === "recent";
      const overflowRight = allowHorizontalExpand
        ? Math.max(rect.right, subRect.right) - window.innerWidth
        : 0;
      if (overflowCss <= 0 && overflowRight <= 0) return;

      try {
        if (!originalWindowSizeRef.current) {
          originalWindowSizeRef.current = new LogicalSize(
            window.innerWidth,
            window.innerHeight,
          );
        }
        const base = originalWindowSizeRef.current;
        const maxHeight = window.screen?.availHeight ?? base.height;
        const nextHeight = Math.min(
          Math.max(window.innerHeight, window.innerHeight + Math.max(overflowCss, 0) + 8),
          maxHeight,
        );
        const maxWidth = window.screen?.availWidth ?? base.width;
        const nextWidth = Math.min(
          Math.max(window.innerWidth, window.innerWidth + Math.max(overflowRight, 0) + 8),
          maxWidth,
        );

        if (nextHeight > base.height || nextWidth > base.width) {
          expandedWindowRef.current = true;
          await windowHandle.setSize(new LogicalSize(nextWidth, nextHeight));
        }
      } catch (error) {
        console.error("Failed to expand window for menu", error);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [openFileSubmenu, openMenu, windowHandle]);

  useEffect(() => {
    if (openMenu !== "edit") {
      setEditMenuLeft(null);
      return;
    }
    const updateLeft = () => {
      if (!editMenuWrapperRef.current || !menuRef.current) return;
      if (window.innerWidth > 640) {
        setEditMenuLeft(null);
        return;
      }
      const wrapperRect = editMenuWrapperRef.current.getBoundingClientRect();
      const groupRect = menuRef.current.getBoundingClientRect();
      setEditMenuLeft(groupRect.left - wrapperRect.left);
    };
    updateLeft();
    window.addEventListener("resize", updateLeft);
    return () => window.removeEventListener("resize", updateLeft);
  }, [openMenu]);

  useEffect(() => {
    if (openMenu !== "view") {
      setViewMenuLeft(null);
      return;
    }
    const updateLeft = () => {
      if (!viewMenuWrapperRef.current || !menuRef.current) return;
      if (window.innerWidth > 640) {
        setViewMenuLeft(null);
        return;
      }
      const wrapperRect = viewMenuWrapperRef.current.getBoundingClientRect();
      const groupRect = menuRef.current.getBoundingClientRect();
      setViewMenuLeft(groupRect.left - wrapperRect.left);
    };
    updateLeft();
    window.addEventListener("resize", updateLeft);
    return () => window.removeEventListener("resize", updateLeft);
  }, [openMenu]);

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
    const newTab: Tab = { id, title: "タイトルなし", content: "" };
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
        const fallback: Tab = { id: "initial", title: "タイトルなし", content: "" };
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
  }, [pushRecentClosedFile]);

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
    // contentEditable 由来のHTMLは state 保存前に必ず sanitize する。
    const clean = sanitizeEditorHtml(stripSearchHighlights(content));
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, content: clean } : t)),
    );
  }, [activeTab, stripSearchHighlights]);

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
        const text = await navigator.clipboard.readText();
        document.execCommand("insertText", false, text);
      } catch (error) {
        console.error("clipboard read failed", error);
        setStatus("Clipboard access unavailable");
      }
    } else {
      setStatus("Clipboard access unavailable");
    }
    window.requestAnimationFrame(() => {
      updateContent(editor.innerHTML);
      updateCursorIndex();
    });
  }, [restoreEditorSelection, updateContent, updateCursorIndex]);

  const handleEditorPaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    restoreEditorSelection();
    const text = event.clipboardData.getData("text/plain");
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
    const text = event.dataTransfer.getData("text/plain");
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
    setOpenMenu(null);
    setShowSearchBox(true);
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const focusReplaceBox = useCallback(() => {
    setOpenMenu(null);
    setShowSearchBox(true);
    replaceInputRef.current?.focus();
    replaceInputRef.current?.select();
  }, []);

  const openGoToLine = useCallback(() => {
    setOpenMenu(null);
    setGoToLineValue(String(cursorPosition.line));
    setGoToLineOpen(true);
  }, [cursorPosition.line]);

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
        applyEditorHtml(editor, sanitizedActiveHtml);
        return;
      }
      const baseHtml = stripSearchHighlights(sanitizedActiveHtml);
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
    [applyEditorHtml, sanitizedActiveHtml, stripSearchHighlights],
  );

  const replaceMatches = useCallback(
    (mode: "one" | "all") => {
      const trimmed = searchQuery.trim();
      if (!trimmed || !activeTab) return;
      const nextHtml = replaceTextInHtml(sanitizedActiveHtml, trimmed, replaceQuery, mode);
      updateContent(nextHtml);
      window.requestAnimationFrame(() => applySearchHighlights(trimmed));
    },
    [activeTab, applySearchHighlights, replaceQuery, sanitizedActiveHtml, searchQuery, updateContent],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (showSearchBox && searchQuery.trim()) {
      applySearchHighlights(searchQuery);
      return;
    }
    setSearchMatchCount(0);
    applyEditorHtml(editor, sanitizedActiveHtml);
  }, [activeTabId, applyEditorHtml, applySearchHighlights, sanitizedActiveHtml, searchQuery, settingsOpen, showSearchBox]);

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

  const toggleMaximizeWindow = async () => {
    const nextMaximized = await windowHandle.isMaximized();
    if (nextMaximized) {
      await windowHandle.unmaximize();
    } else {
      await windowHandle.maximize();
    }
    await syncWindowMaximizedState();
  };

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

  const shortcutActions = useMemo(
    () => [
      { id: "alwaysOnTop", combo: "Ctrl+Alt+T", action: toggleAlwaysOnTop },
      { id: "snapLeft", combo: "Ctrl+Alt+Left", action: snapLeft },
      { id: "snapRight", combo: "Ctrl+Alt+Right", action: snapRight },
      { id: "minimumSize", combo: "Ctrl+Alt+J", action: resizeToMinimum },
      { id: "fitContent", combo: "Ctrl+Alt+K", action: resizeToFitContent },
    ],
    [
      resizeToFitContent,
      resizeToMinimum,
      snapLeft,
      snapRight,
      toggleAlwaysOnTop,
    ],
  );

  useEffect(() => {
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    void syncWindowMaximizedState();
    void windowHandle.onResized(() => {
      void syncWindowMaximizedState();
    }).then((cleanup) => {
      unlistenResize = cleanup;
    }).catch((error) => {
      console.error("Failed to listen for resize", error);
    });
    void windowHandle.onMoved(() => {
      void syncWindowMaximizedState();
    }).then((cleanup) => {
      unlistenMove = cleanup;
    }).catch((error) => {
      console.error("Failed to listen for move", error);
    });
    return () => {
      unlistenResize?.();
      unlistenMove?.();
    };
  }, [syncWindowMaximizedState, windowHandle]);

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
        case "KeyT": {
          event.preventDefault();
          setStatus("Hotkey: toggle always on top");
          void toggleAlwaysOnTop();
          break;
        }
        case "ArrowLeft": {
          event.preventDefault();
          setStatus("Hotkey: snap left");
          void snapLeft();
          break;
        }
        case "ArrowRight": {
          event.preventDefault();
          setStatus("Hotkey: snap right");
          void snapRight();
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
    openFilePicker,
    openNewWindow,
    resizeToFitContent,
    resizeToMinimum,
    saveActiveTab,
    snapLeft,
    snapRight,
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
          setStatus(`Global shortcut error: ${message}`);
          throw error;
        }
      }
      setStatus("Global shortcuts active");
    };

    const configure = async () => {
      try {
        if (useGlobalShortcuts) {
          await registerGlobalShortcuts();
        } else {
          await unregisterAll();
          setStatus("Local shortcuts active (window focused)");
        }
      } catch (error) {
        console.error(error);
        setStatus("Failed to configure shortcuts");
      }
    };

    void configure();

    return () => {
      void unregisterAll().catch((error) => {
        console.error("Failed to unregister shortcuts", error);
      });
    };
  }, [shortcutActions, useGlobalShortcuts]);

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
  }, [handleTopTabsWheel, settingsOpen]);

  useEffect(() => {
    return () => {
      if (tabsWheelRafRef.current !== null) {
        window.cancelAnimationFrame(tabsWheelRafRef.current);
      }
    };
  }, []);

  const getTabLabel = (tab: Tab) => {
    if (!DEFAULT_TITLE_REGEX.test(tab.title)) return tab.title;
    const trimmed = htmlToText(tab.content).trimStart();
    if (!trimmed) return tab.title;
    const firstLine = trimmed.split(/\r?\n/)[0] ?? "";
    const maxLength = 20;
    if (firstLine.length > maxLength) {
      return `${firstLine.slice(0, maxLength)}...`;
    }
    return firstLine || tab.title;
  };

  return (
    <div className={`app theme-${effectiveTheme} ${isWindowMaximized ? "window-maximized" : ""}`}>
      {!settingsOpen ? (
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
                      const next = window.prompt("タブ名を変更", tab.title);
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
                      aria-label={isTabDirty(tab) ? "Unsaved" : "Close"}
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
              title="新規タブ"
            >
              <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <div className="drag-region" onPointerDown={handleWindowDragStart} />
          <div className="window-controls">
            <button
              type="button"
              className="window-button"
              onClick={minimizeWindow}
              aria-label="最小化"
            >
              <Minus className="window-icon" strokeWidth={1.2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="window-button"
              onClick={toggleMaximizeWindow}
              aria-label={isWindowMaximized ? "元に戻す" : "最大化"}
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
              aria-label="閉じる"
            >
              <X className="window-icon close-window-icon" strokeWidth={1.2} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="titlebar-row toolbar">
          {settingsOpen ? (
            <div className="settings-toolbar">
              <button
                type="button"
                className="settings-back"
                onClick={() => setSettingsOpen(false)}
                aria-label="Back to editor"
              >
                <ArrowLeft size={16} strokeWidth={1.9} aria-hidden="true" />
              </button>
              <span className="settings-toolbar-title">設定</span>
            </div>
          ) : (
            <>
              <div className="menu-group" ref={menuRef}>
            <div className="menu-wrapper">
              <button
                type="button"
                className={`menu-button file-menu-button ${openMenu === "file" ? "active" : ""}`}
                onClick={() => setOpenMenu((prev) => (prev === "file" ? null : "file"))}
              >
                ファイル
              </button>
              {openMenu === "file" ? (
                <div
                  className="menu-panel"
                  ref={fileMenuRef}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <button type="button" className="menu-item" onClick={() => { addTab(); closeMenus(); }}>
                    <span>新しいタブ</span>
                    <span className="menu-shortcut">Ctrl+N</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => void openNewWindow()}>
                    <span>新しいウィンドウ</span>
                    <span className="menu-shortcut">Ctrl+Shift+N</span>
                  </button>
                  <div className="menu-divider" />
                  <button type="button" className="menu-item" onClick={openFilePicker}>
                    <span>開く</span>
                    <span className="menu-shortcut">Ctrl+O</span>
                  </button>
                  <div
                    className="menu-submenu-wrap"
                    onMouseLeave={() => setOpenFileSubmenu(null)}
                  >
                    <button
                      type="button"
                      className="menu-item has-submenu"
                      onMouseEnter={() => setOpenFileSubmenu("recent")}
                      onClick={() => setOpenFileSubmenu("recent")}
                    >
                      <span>新着順</span>
                      <span className="menu-shortcut">›</span>
                    </button>
                    {openFileSubmenu === "recent" ? (
                      <div className="menu-panel menu-subpanel menu-subpanel-recent" ref={fileRecentSubmenuRef}>
                        {recentClosedFiles.length === 0 ? (
                          <button type="button" className="menu-item disabled" aria-disabled="true">
                            <span>最近閉じたファイルはありません</span>
                          </button>
                        ) : (
                          recentClosedFiles.slice(0, MAX_RECENT_CLOSED_FILES).map((item) => (
                            <button
                              key={item.path}
                              type="button"
                              className="menu-item"
                              onClick={() => void openRecentClosedFile(item.path)}
                              title={item.path}
                            >
                              <span>{item.title}</span>
                            </button>
                          ))
                        )}
                        {recentClosedFiles.length > 0 ? <div className="menu-divider" /> : null}
                        <button
                          type="button"
                          className={`menu-item ${recentClosedFiles.length === 0 ? "disabled" : ""}`}
                          aria-disabled={recentClosedFiles.length === 0}
                          onClick={() => {
                            if (recentClosedFiles.length === 0) return;
                            clearRecentClosedFiles();
                          }}
                        >
                          <span>一覧を消去する</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="menu-divider" />
                  <button type="button" className="menu-item" onClick={() => void saveActiveTab()}>
                    <span>保存</span>
                    <span className="menu-shortcut">Ctrl+S</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => void saveActiveTabAs()}>
                    <span>名前を付けて保存</span>
                    <span className="menu-shortcut">Ctrl+Shift+S</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => void saveAllTabs()}>
                    <span>すべて保存</span>
                    <span className="menu-shortcut">Ctrl+Alt+S</span>
                  </button>
                  <div className="menu-divider" />
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>ページ設定</span>
                  </button>
                  <div className="menu-divider" />
                  <button
                    type="button"
                    className="menu-item toggle"
                    onClick={() => setAlwaysOnTop(!alwaysOnTop)}
                  >
                    <span>常に手前に表示</span>
                    <span className={`menu-toggle ${alwaysOnTop ? "on" : ""}`} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="menu-item toggle"
                    onClick={() => setUseGlobalShortcuts((prev) => !prev)}
                  >
                    <span>グローバルショートカット</span>
                    <span className={`menu-toggle ${useGlobalShortcuts ? "on" : ""}`} aria-hidden="true" />
                  </button>
                  <div className="menu-divider" />
                  <button type="button" className="menu-item" onClick={closeActiveTab}>
                    <span>タブを閉じる</span>
                    <span className="menu-shortcut">Ctrl+W</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => { closeWindow(); closeMenus(); }}>
                    <span>ウィンドウを閉じる</span>
                    <span className="menu-shortcut">Ctrl+Shift+W</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => { closeWindow(); closeMenus(); }}>
                    <span>終了</span>
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
                編集
              </button>
              {openMenu === "edit" ? (
                <div
                  className="menu-panel"
                  ref={editMenuRef}
                  style={editMenuLeft !== null ? { left: `${editMenuLeft}px` } : undefined}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <button type="button" className="menu-item" onClick={() => { runEditorCommand("undo"); closeMenus(); }}>
                    <span>元に戻す</span>
                    <span className="menu-shortcut">Ctrl+Z</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => { runEditorCommand("cut"); closeMenus(); }}>
                    <span>切り取り</span>
                    <span className="menu-shortcut">Ctrl+X</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => { runEditorCommand("copy"); closeMenus(); }}>
                    <span>コピー</span>
                    <span className="menu-shortcut">Ctrl+C</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => { void pasteFromClipboard(); closeMenus(); }}>
                    <span>貼り付け</span>
                    <span className="menu-shortcut">Ctrl+V</span>
                  </button>
                  <div className="menu-divider" />
                  <button type="button" className="menu-item" onClick={() => { focusSearchBox(); closeMenus(); }}>
                    <span>検索する</span>
                    <span className="menu-shortcut">Ctrl+F</span>
                  </button>
                  <button type="button" className="menu-item" onClick={() => { focusReplaceBox(); closeMenus(); }}>
                    <span>置換</span>
                    <span className="menu-shortcut">Ctrl+H</span>
                  </button>
                  <button type="button" className="menu-item" onClick={openGoToLine}>
                    <span>移動先</span>
                    <span className="menu-shortcut">Ctrl+G</span>
                  </button>
                  <div className="menu-divider" />
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>フォント</span>
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
                表示
              </button>
              {openMenu === "view" ? (
                <div
                  className="menu-panel"
                  ref={viewMenuRef}
                  style={viewMenuLeft !== null ? { left: `${viewMenuLeft}px` } : undefined}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <button type="button" className="menu-item" onClick={zoomIn}>
                    <span>拡大</span>
                    <span className="menu-shortcut">Ctrl+プラス記号 (+)</span>
                  </button>
                  <button type="button" className="menu-item" onClick={zoomOut}>
                    <span>縮小</span>
                    <span className="menu-shortcut">Ctrl+マイナス記号 (-)</span>
                  </button>
                  <button type="button" className="menu-item" onClick={resetZoom}>
                    <span>既定の倍率に戻す</span>
                    <span className="menu-shortcut">Ctrl+0</span>
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => setShowStatusBar((prev) => !prev)}
                  >
                    <span className={`menu-check ${showStatusBar ? "on" : ""}`}>✓</span>
                    <span>ステータスバー</span>
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => setWrapAtRightEdge((prev) => !prev)}
                  >
                    <span className={`menu-check ${wrapAtRightEdge ? "on" : ""}`}>✓</span>
                    <span>右端での折り返し</span>
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
                  placeholder="検索"
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
                  <span className="search-count">{searchMatchCount} 件</span>
                ) : null}
                <button
                  type="button"
                  className="search-close"
                  onClick={() => setShowSearchBox(false)}
                  aria-label="Close search"
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
                  placeholder="置換"
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
                  置換
                </button>
                <button
                  type="button"
                  className="search-action"
                  onClick={() => replaceMatches("all")}
                >
                  すべて置換
                </button>
              </div>
            </div>
          ) : null}
              <div className="right-group">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Settings"
                  onClick={() => {
                    closeMenus();
                    setShowSearchBox(false);
                    setSettingsOpen(true);
                  }}
                >
                  <Settings size={14} strokeWidth={1.9} aria-hidden="true" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      ) : null}

      {settingsOpen ? (
        <section className="settings-screen">
          <div className="settings-drag-region" onPointerDown={handleWindowDragStart} />
          <div className="settings-window-controls">
            <button
              type="button"
              className="window-button"
              onClick={minimizeWindow}
              aria-label="Minimize"
            >
              <Minus className="window-icon" strokeWidth={1.2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="window-button"
              onClick={toggleMaximizeWindow}
              aria-label={isWindowMaximized ? "Restore" : "Maximize"}
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
              aria-label="Close"
            >
              <X className="window-icon close-window-icon" strokeWidth={1.2} aria-hidden="true" />
            </button>
          </div>
          <div className="settings-layout">
            <div className="settings-mobile-header">
              <div className="settings-brand">
                <button
                  type="button"
                  className="settings-brand-back"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="エディタへ戻る"
                >
                  <ArrowLeft className="settings-back-icon" strokeWidth={1.8} aria-hidden="true" />
                </button>
                <div className="settings-brand-name">AlwaysMemo</div>
              </div>
            </div>
            <aside className="settings-sidebar">
              <div className="settings-brand">
                <button
                  type="button"
                  className="settings-brand-back"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="エディタへ戻る"
                >
                  <ArrowLeft className="settings-back-icon" strokeWidth={1.8} aria-hidden="true" />
                </button>
                <div className="settings-brand-name">AlwaysMemo</div>
              </div>
              <div className="settings-nav">
                <button type="button" className={`settings-nav-item ${settingsNav === "appearance" ? "active" : ""}`} onClick={() => jumpToSettingsSection("appearance")}>外観</button>
                <button type="button" className={`settings-nav-item ${settingsNav === "formatting" ? "active" : ""}`} onClick={() => jumpToSettingsSection("formatting")}>書式設定</button>
                <button type="button" className={`settings-nav-item ${settingsNav === "features" ? "active" : ""}`} onClick={() => jumpToSettingsSection("features")}>機能</button>
                <button type="button" className={`settings-nav-item ${settingsNav === "startup" ? "active" : ""}`} onClick={() => jumpToSettingsSection("startup")}>起動時</button>
                <button type="button" className={`settings-nav-item ${settingsNav === "about" ? "active" : ""}`} onClick={() => jumpToSettingsSection("about")}>情報</button>
              </div>
            </aside>

            <div className="settings-content" ref={settingsContentRef}>
              <div className="settings-sections">
              <section id="settings-appearance" className="settings-block">
                <h2>外観</h2>
                <p className="settings-desc">メモ画面の見た目を調整します。</p>
                <div className="theme-options">
                  <button
                    type="button"
                    className={`theme-card ${themeMode === "light" ? "active" : ""}`}
                    onClick={() => setThemeMode("light")}
                  >
                    <span className="theme-icon">
                      <Sun size={18} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <span>ライト</span>
                  </button>
                  <button
                    type="button"
                    className={`theme-card ${themeMode === "dark" ? "active" : ""}`}
                    onClick={() => setThemeMode("dark")}
                  >
                    <span className="theme-icon">
                      <Moon size={18} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <span>ダーク</span>
                  </button>
                  <button
                    type="button"
                    className={`theme-card ${themeMode === "system" ? "active" : ""}`}
                    onClick={() => setThemeMode("system")}
                  >
                    <span className="theme-icon">
                      <Monitor size={18} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <span>システム</span>
                  </button>
                </div>
              </section>

              <section id="settings-formatting" className="settings-block">
                <h2>書式設定</h2>
                <p className="settings-desc">テキストの表示や構造を調整します。</p>
                <div className="settings-card">
                  <div className="settings-field-row">
                    <div><strong>文字サイズ</strong><small>読みやすさに合わせて調整します</small></div>
                    <label className="settings-number-wrap">
                      <input
                        className="settings-number-input"
                        type="number"
                        min={8}
                        max={72}
                        step={1}
                        value={editorFontSizeInput}
                        onChange={(event) => {
                          setEditorFontSizeInput(event.target.value);
                        }}
                        onBlur={() => commitEditorFontSize(editorFontSizeInput)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            commitEditorFontSize(editorFontSizeInput);
                            event.currentTarget.blur();
                          }
                          if (event.key === "Escape") {
                            setEditorFontSizeInput(String(editorFontSizePx));
                            event.currentTarget.blur();
                          }
                        }}
                      />
                      <span>px</span>
                    </label>
                  </div>
                  <div className="settings-field-row">
                    <div><strong>行間</strong><small>行どうしの間隔を調整します</small></div>
                    <select
                      value={lineSpacing}
                      onChange={(event) => {
                        setLineSpacing(event.target.value as LineSpacing);
                      }}
                    >
                      <option value="standard">標準</option>
                      <option value="relaxed">広い</option>
                    </select>
                  </div>
                  <div className="settings-field-row switch">
                    <div><strong>折り返し</strong><small>長い行を自動で折り返します</small></div>
                    <label className="modern-switch">
                      <input
                        type="checkbox"
                        checked={wrapAtRightEdge}
                        onChange={(event) => {
                          const anchor = event.currentTarget.closest(".settings-field-row") as HTMLElement | null;
                          keepSettingsViewport(anchor, () => {
                            setWrapAtRightEdge(event.target.checked);
                          });
                        }}
                      />
                      <span />
                    </label>
                  </div>
                  <div
                    className="settings-preview"
                    data-wrap={wrapAtRightEdge ? "on" : "off"}
                    data-line-spacing={lineSpacing}
                    style={{ fontSize: `${previewFontSizePx}px`, lineHeight: previewLineHeight }}
                  >
                    <p className="settings-preview-title">プレビュー:</p>
                    <p className="settings-preview-line">alwaysmemoの表示サンプルです。</p>
                    <p className="settings-preview-line">この文章は折り返し設定の確認用に、少し長めのテキストを表示しています。</p>
                  </div>
                </div>
              </section>

              <section id="settings-features" className="settings-block">
                <h2>機能</h2>
                <p className="settings-desc">作業効率を高める機能を設定します。</p>
                <div className="feature-row">
                  <div><strong>常に手前に表示</strong><small>他のアプリより前面に表示します</small></div>
                  <label className="modern-switch">
                    <input
                      type="checkbox"
                      checked={alwaysOnTop}
                      onChange={(event) => {
                        const anchor = event.currentTarget.closest(".feature-row") as HTMLElement | null;
                        keepSettingsViewport(anchor, async () => {
                          await setAlwaysOnTop(event.target.checked);
                        });
                      }}
                    />
                    <span />
                  </label>
                </div>
                <div className="feature-row">
                  <div><strong>グローバルショートカット</strong><small>OS 全体から操作を呼び出せます</small></div>
                  <label className="modern-switch">
                    <input
                      type="checkbox"
                      checked={useGlobalShortcuts}
                      onChange={(event) => {
                        const anchor = event.currentTarget.closest(".feature-row") as HTMLElement | null;
                        keepSettingsViewport(anchor, () => {
                          setUseGlobalShortcuts(event.target.checked);
                        });
                      }}
                    />
                    <span />
                  </label>
                </div>
              </section>

              <section id="settings-startup" className="settings-block">
                <h2>起動時</h2>
                <p className="settings-desc">起動時の動作を設定します。</p>
                <div className="startup-grid">
                  <div className="startup-card">
                    <strong>セッション</strong>
                    <label>
                      <input
                        type="radio"
                        name="session"
                        checked={sessionBehavior === "restore"}
                        onChange={() => setSessionBehavior("restore")}
                      />
                      前回の状態を復元
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="session"
                        checked={sessionBehavior === "new"}
                        onChange={() => setSessionBehavior("new")}
                      />
                      常に新規で開始
                    </label>
                  </div>
                  <div className="startup-card">
                    <strong>ファイルの開き方</strong>
                    <label>
                      <input
                        type="radio"
                        name="open"
                        checked={fileOpenBehavior === "existing"}
                        onChange={() => setFileOpenBehavior("existing")}
                      />
                      既存ウィンドウに追加
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="open"
                        checked={fileOpenBehavior === "new_window"}
                        onChange={() => setFileOpenBehavior("new_window")}
                      />
                      新しいウィンドウで開く
                    </label>
                  </div>
                </div>
              </section>

              <section id="settings-about" className="settings-about-card">
                <div className="about-logo">🗒</div>
                <h3>AlwaysMemo</h3>
                <p>作業を中断せず、必要なメモをすぐ残せるツールです。</p>
                <div className="about-meta">
                  <span>バージョン 0.1</span>
                  <span>ビルド dev</span>
                  <span>MIT ライセンス</span>
                </div>
              </section>
              </div>
            </div>
          </div>
        </section>
      ) : (
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
              data-placeholder="ここにメモを書く"
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
      )}

      {windowClosePromptOpen ? (
        <div className="format-choice-overlay" role="presentation">
          <div
            className="delete-choice-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="window-close-title"
            aria-describedby="window-close-desc"
          >
            <h2 id="window-close-title">確認</h2>
            <p id="window-close-desc">
              {dirtyTabCount > 1
                ? `${dirtyTabCount} 件の未保存メモがあります。保存してから終了しますか？`
                : "未保存のメモがあります。保存してから終了しますか？"}
            </p>
            <div className="delete-choice-actions">
              <button
                type="button"
                className="delete-choice primary"
                onClick={() => {
                  void saveAndCloseWindow();
                }}
              >
                保存
              </button>
              <button
                type="button"
                className="delete-choice"
                onClick={() => {
                  void discardAndCloseWindow();
                }}
              >
                保存しない
              </button>
              <button
                type="button"
                className="delete-choice ghost"
                onClick={() => setWindowClosePromptOpen(false)}
              >
                キャンセル
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
            <h2 id="delete-choice-title">確認</h2>
            <p id="delete-choice-desc">
              {`${deletePromptTab.filePath ?? deletePromptTab.title} への変更内容を保存しますか？`}
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
                保存
              </button>
              <button
                type="button"
                className="delete-choice"
                onClick={() => {
                  closeTabWithAnimation(deletePromptTab.id);
                  setDeletePromptTabId(null);
                }}
              >
                保存しない
              </button>
              <button
                type="button"
                className="delete-choice ghost"
                onClick={() => setDeletePromptTabId(null)}
              >
                キャンセル
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
            <h2 id="goto-line-title">行に移動</h2>
            <label htmlFor="goto-line-input">行番号</label>
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
                移動
              </button>
              <button
                type="button"
                className="goto-line-button"
                onClick={() => setGoToLineOpen(false)}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showStatusBar && !settingsOpen ? (
        <div className="bottom-bar">
          <span className="bottom-item">行 {cursorPosition.line}, 列 {cursorPosition.column}</span>
          <span className="bottom-item">{activePlainText.length} 文字</span>
          <span className="bottom-item">{zoomPercentLabel}</span>
          <span className="bottom-item">{lineEndingLabel}</span>
          <span className="bottom-item">UTF-8</span>
          <span className="bottom-item">
            <span className="bottom-label">Top: </span>
            <span className="bottom-value">{alwaysOnTop ? "ON" : "OFF"}</span>
          </span>
          <span className="bottom-item">
            <span className="bottom-label">Shortcuts: </span>
            <span className="bottom-value">{useGlobalShortcuts ? "ON" : "OFF"}</span>
          </span>
        </div>
      ) : null}

    </div>
  );
}

export default App;
