import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import "./App.css";

const MIN_WINDOW_WIDTH = 300;
const MIN_WINDOW_HEIGHT = 200;
const STORAGE_KEY = "alwaysmemo-state";

type Tab = {
  id: string;
  title: string;
  content: string;
  filePath?: string | null;
};

const DEFAULT_TITLE_REGEX = /^タイトルなし$/;

type SnapPosition = "left" | "right" | null;

type PersistedState = {
  tabs: Tab[];
  activeTabId: string | null;
  alwaysOnTop: boolean;
  snap: SnapPosition;
  useGlobalShortcuts: boolean;
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
  const [status, setStatus] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "initial", title: "タイトルなし", content: "" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("initial");
  const [snap, setSnap] = useState<SnapPosition>(null);
  const toggleLockRef = useRef(0);
  const tabsScrollerRef = useRef<HTMLDivElement | null>(null);
  const topTitlebarRef = useRef<HTMLDivElement | null>(null);
  const pendingRevealTabIdRef = useRef<string | null>(null);
  const tabsWheelTargetRef = useRef<number | null>(null);
  const tabsWheelRafRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedSelectionRef = useRef<Range | null>(null);
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
  const originalWindowSizeRef = useRef<LogicalSize | null>(null);
  const expandedWindowRef = useRef(false);
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [wrapAtRightEdge, setWrapAtRightEdge] = useState(true);
  const [deletePromptTabId, setDeletePromptTabId] = useState<string | null>(null);
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
  const windowHandle = getCurrentWindow();
  const activeHtml = activeTab?.content ?? "";
  const activePlainText = useMemo(() => {
    const div = document.createElement("div");
    div.innerHTML = activeHtml;
    return nodeToPlainText(div).replace(/\u00a0/g, " ");
  }, [activeHtml]);
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
    const cursorText = normalized.endsWith("\n")
      ? normalized.slice(0, -1)
      : normalized;
    const lines = cursorText.split("\n");
    setCursorPosition({
      line: Math.max(lines.length, 1),
      column: (lines[lines.length - 1]?.length ?? 0) + 1,
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
      };
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    },
    [activeTabId, alwaysOnTop, snap, storageKey, useGlobalShortcuts],
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
      if (/<[^>]+>/.test(content)) return content;
      return textToHtml(content);
    },
    [textToHtml],
  );

  const htmlToText = useCallback((html: string) => {
    const div = document.createElement("div");
    div.innerHTML = html;
    return nodeToPlainText(div).replace(/\u00a0/g, " ");
  }, []);

  const stripSearchHighlights = useCallback((html: string) => {
    const container = document.createElement("div");
    container.innerHTML = html;
    container.querySelectorAll("mark.search-hit").forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });
    return container.innerHTML;
  }, []);

  const hasRichFormatting = useCallback((html: string) => {
    const container = document.createElement("div");
    container.innerHTML = html;
    return Boolean(
      container.querySelector(
        "strong, b, em, i, u, a, table, thead, tbody, tr, td, th, ul, ol, li, h1, h2, h3, h4, h5, h6",
      ),
    );
  }, []);

  const pickSavePath = useCallback(async (suggested: string) => {
    const withExt = suggested.includes(".") ? suggested : `${suggested}.txt`;
    const defaultPath = withExt;
    let resolvedPath: string | null = null;
    let dialogFailed = false;
    const filters = [{ name: "Text", extensions: ["txt"] }];
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
    return resolvedPath;
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
    return /\.txt$/i.test(path);
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
      setPathMap({ ...pathMap, [id]: opened.path, [title]: opened.path });
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
      const id = crypto.randomUUID();
      const title = getFileNameFromPath(opened.path) || `メモ ${tabs.length + 1}`;
      const content = textToHtml(opened.contents);
      const pathMap = getPathMap();
      setPathMap({ ...pathMap, [id]: opened.path, [title]: opened.path });
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
  }, [closeMenus, getPathMap, persistState, setPathMap, tabs, textToHtml]);

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
      setPathMap({ ...pathMap, [tab.id]: resolvedPath, [nextTitle]: resolvedPath });
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
      resolvedPath = pathMap[tab.id] ?? pathMap[tab.title] ?? null;
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
      if (!pathMap[tab.id] || !pathMap[tab.title]) {
        setPathMap({
          ...pathMap,
          [tab.id]: resolvedPath,
          [tab.title]: resolvedPath,
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

  const shortcutActions = useMemo(
    () => [
      { id: "alwaysOnTop", combo: "Ctrl+Alt+T", action: toggleAlwaysOnTop },
      { id: "snapLeft", combo: "Ctrl+Alt+Left", action: snapLeft },
      { id: "snapRight", combo: "Ctrl+Alt+Right", action: snapRight },
      { id: "minimumSize", combo: "Ctrl+Alt+J", action: resizeToMinimum },
      { id: "fitContent", combo: "Ctrl+Alt+K", action: resizeToFitContent },
    ],
    [resizeToFitContent, resizeToMinimum, snapLeft, snapRight, toggleAlwaysOnTop],
  );

  useEffect(() => {
    const initState = async () => {
      try {
        await windowHandle.setMinSize(
          new LogicalSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT),
        );
        const current = await invoke<boolean>("get_always_on_top");
        const params = new URLSearchParams(window.location.search);
        const alwaysOnTopParam = params.get("alwaysOnTop");
        const forceAlwaysOnTopDefined = alwaysOnTopParam !== null;
        const forceAlwaysOnTop =
          alwaysOnTopParam === "1" || alwaysOnTopParam === "true";
        const stored = window.localStorage.getItem(storageKey);
        if (stored) {
          const parsed = JSON.parse(stored) as PersistedState;
          const pathMap = getPathMap();
          const restoredTabs = (parsed.tabs.length
            ? parsed.tabs
            : [{ id: "initial", title: "タイトルなし", content: "" }]
          ).map((tab) => ({
            ...tab,
            content: normalizeHtml(tab.content),
            filePath: tab.filePath ?? pathMap[tab.id] ?? pathMap[tab.title] ?? null,
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
      } catch (error) {
        console.error(error);
        setStatus("Failed to read always on top state");
      }
    };
    void initState();
  }, []);

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
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey) {
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
          case "KeyS": {
            event.preventDefault();
            void saveActiveTab();
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
    resizeToFitContent,
    resizeToMinimum,
    saveActiveTab,
    snapLeft,
    snapRight,
    toggleAlwaysOnTop,
  ]);

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

  const addTab = () => {
    const id = crypto.randomUUID();
    const newTab: Tab = { id, title: "タイトルなし", content: "" };
    savedTabsRef.current = {
      ...savedTabsRef.current,
      [id]: { title: newTab.title, content: newTab.content },
    };
    pendingRevealTabIdRef.current = id;
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    const revealNewTab = (retriesLeft: number) => {
      const pendingId = pendingRevealTabIdRef.current;
      if (!pendingId) return;
      const scroller = tabsScrollerRef.current;
      if (!scroller) return;
      const targetTab = Array.from(scroller.querySelectorAll<HTMLElement>(".tab")).find(
        (element) => element.dataset.tabId === pendingId,
      );
      if (!targetTab) {
        if (retriesLeft > 0) {
          window.requestAnimationFrame(() => revealNewTab(retriesLeft - 1));
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
    window.requestAnimationFrame(() => revealNewTab(10));
  };

  const performRemoveTab = useCallback((id: string) => {
    setTabs((prev) => {
      const removed = prev.find((t) => t.id === id);
      if (removed) {
        pushRecentClosedFile(removed);
      }
      const nextTabs = prev.filter((t) => t.id !== id);
      if (nextTabs.length === 0) {
        const fallback: Tab = { id: "initial", title: "タイトルなし", content: "" };
        setActiveTabId(fallback.id);
        return [fallback];
      }
      if (activeTabId === id) {
        setActiveTabId(nextTabs[0]?.id ?? nextTabs[0].id);
      }
      return nextTabs;
    });
  }, [activeTabId, pushRecentClosedFile]);

  const requestRemoveTab = useCallback((id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (isTabDirty(tab)) {
      setDeletePromptTabId(tab.id);
      return;
    }
    performRemoveTab(id);
  }, [performRemoveTab, tabs]);

  const closeActiveTab = useCallback(() => {
    if (!activeTab) return;
    void requestRemoveTab(activeTab.id);
    closeMenus();
  }, [activeTab, closeMenus, requestRemoveTab]);

  const renameTab = (id: string, title: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  };

  const updateContent = useCallback((content: string) => {
    if (!activeTab) return;
    const clean = stripSearchHighlights(content);
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
        document.execCommand("paste");
      }
    } else {
      document.execCommand("paste");
    }
    window.requestAnimationFrame(() => {
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
          foundOffset = Array.from(current.parentNode?.childNodes ?? []).indexOf(current);
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
        if (editor.innerHTML !== activeHtml) {
          editor.innerHTML = activeHtml;
        }
        return;
      }
      const baseHtml = stripSearchHighlights(activeHtml);
      const container = document.createElement("div");
      container.innerHTML = baseHtml;
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");
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
      editor.innerHTML = container.innerHTML;
      setSearchMatchCount(count);
      const firstHit = editor.querySelector("mark.search-hit");
      if (firstHit) {
        (firstHit as HTMLElement).scrollIntoView({ block: "center" });
      }
    },
    [activeHtml, stripSearchHighlights],
  );

  const replaceMatches = useCallback(
    (mode: "one" | "all") => {
      const trimmed = searchQuery.trim();
      if (!trimmed || !activeTab) return;
      const baseHtml = stripSearchHighlights(activeHtml);
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, mode === "all" ? "gi" : "i");
      const replacement = replaceQuery;
      const nextHtml = baseHtml.replace(regex, replacement);
      updateContent(nextHtml);
      window.requestAnimationFrame(() => applySearchHighlights(trimmed));
    },
    [activeHtml, activeTab, applySearchHighlights, replaceQuery, searchQuery, stripSearchHighlights, updateContent],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (showSearchBox && searchQuery.trim()) {
      applySearchHighlights(searchQuery);
      return;
    }
    setSearchMatchCount(0);
    if (editor.innerHTML !== activeHtml) {
      editor.innerHTML = activeHtml;
    }
  }, [activeHtml, activeTabId, applySearchHighlights, searchQuery, showSearchBox]);

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

  const minimizeWindow = async () => {
    await windowHandle.minimize();
  };

  const toggleMaximizeWindow = async () => {
    const isMaximized = await windowHandle.isMaximized();
    if (isMaximized) {
      await windowHandle.unmaximize();
    } else {
      await windowHandle.maximize();
    }
  };

  const closeWindow = async () => {
    await windowHandle.close();
  };

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
    tabsWheelTargetRef.current = Math.max(0, Math.min(maxLeft, baseLeft + delta * 1.4));
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

  const isTabDirty = (tab: Tab) => {
    const saved = savedTabsRef.current[tab.id];
    if (!saved) return true;
    return saved.title !== tab.title || saved.content !== tab.content;
  };

  return (
    <div className="app">
      <div className="titlebar">
        <div className="titlebar-row top" data-tauri-drag-region ref={topTitlebarRef}>
          <div className="tabs-area" data-tauri-drag-region>
            <div className="tabs-bar" data-tauri-drag-region>
              <div
                className="tabs"
                ref={tabsScrollerRef}
                data-tauri-drag-region
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
                    className={`tab ${tab.id === activeTabId ? "active" : ""} ${draggedTabId === tab.id ? "dragging" : ""}`}
                    onClick={() => setActiveTabId(tab.id)}
                    onDoubleClick={() => {
                      const next = window.prompt("タブ名を変更", tab.title);
                      if (next?.trim()) renameTab(tab.id, next.trim());
                    }}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", tab.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDraggedTabId(tab.id);
                    }}
                    onDragEnd={() => setDraggedTabId(null)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const fromId = event.dataTransfer.getData("text/plain");
                      moveTab(fromId, tab.id);
                      setDraggedTabId(null);
                    }}
                    data-tauri-drag-region="false"
                  >
                    <span className="tab-title">{getTabLabel(tab)}</span>
                    <span
                      className={`tab-close ${isTabDirty(tab) ? "dirty" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void requestRemoveTab(tab.id);
                      }}
                      data-tauri-drag-region="false"
                      aria-label={isTabDirty(tab) ? "Unsaved" : "Close"}
                    >
                      {isTabDirty(tab) ? "●" : "×"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <button
              className="add-tab"
              onClick={addTab}
              title="新規タブ"
              data-tauri-drag-region="false"
            >
              +
            </button>
          </div>
          <div className="window-controls">
            <button
              type="button"
              className="window-button"
              onClick={minimizeWindow}
              aria-label="Minimize"
              data-tauri-drag-region="false"
            >
              <svg className="window-icon" viewBox="0 0 10 10" aria-hidden="true">
                <line x1="2" y1="7" x2="8" y2="7" />
              </svg>
            </button>
            <button
              type="button"
              className="window-button"
              onClick={toggleMaximizeWindow}
              aria-label="Maximize"
              data-tauri-drag-region="false"
            >
              <svg className="window-icon" viewBox="0 0 10 10" aria-hidden="true">
                <rect x="2" y="2" width="6" height="6" fill="none" />
              </svg>
            </button>
            <button
              type="button"
              className="window-button close"
              onClick={closeWindow}
              aria-label="Close"
              data-tauri-drag-region="false"
            >
              <svg className="window-icon" viewBox="0 0 10 10" aria-hidden="true">
                <line x1="2.2" y1="2.2" x2="7.8" y2="7.8" />
                <line x1="7.8" y1="2.2" x2="2.2" y2="7.8" />
              </svg>
            </button>
          </div>
        </div>
        <div className="titlebar-row toolbar">
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
                  <div className="menu-submenu-wrap">
                    <button
                      type="button"
                      className="menu-item has-submenu"
                      onMouseEnter={() => setOpenFileSubmenu("recent")}
                      onClick={() => setOpenFileSubmenu((prev) => (prev === "recent" ? null : "recent"))}
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
                    <span>Always on top</span>
                    <span className={`menu-toggle ${alwaysOnTop ? "on" : ""}`} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="menu-item toggle"
                    onClick={() => setUseGlobalShortcuts((prev) => !prev)}
                  >
                    <span>Global shortcuts</span>
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
                <span className="search-icon">🔍</span>
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
                  ×
                </button>
              </div>
              <div className="search-bar">
                <span className="search-icon">↻</span>
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
            <button type="button" className="icon-button account" aria-label="Account">
              ●
            </button>
            <button type="button" className="icon-button" aria-label="Settings">
              ⚙
            </button>
          </div>
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
            contentEditable
            suppressContentEditableWarning
            data-placeholder="ここにメモを書く"
            onInput={(event) => {
              updateContent(event.currentTarget.innerHTML);
              scheduleCursorIndexUpdate();
            }}
            onKeyUp={scheduleCursorIndexUpdate}
            onMouseUp={scheduleCursorIndexUpdate}
            onClick={scheduleCursorIndexUpdate}
          />
        </div>
      </section>

      {deletePromptTab ? (
        <div className="format-choice-overlay" role="presentation">
          <div
            className="delete-choice-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-choice-title"
            aria-describedby="delete-choice-desc"
          >
            <h2 id="delete-choice-title">メモ帳</h2>
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
                      performRemoveTab(tab.id);
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
                  performRemoveTab(deletePromptTab.id);
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

      {showStatusBar ? (
        <div className="bottom-bar">
          <span className="bottom-item">行 {cursorPosition.line}, 列 {cursorPosition.column}</span>
          <span className="bottom-item">{activePlainText.length} 文字</span>
          <span className="bottom-item">
            {activeTab && hasRichFormatting(activeTab.content) ? "書式付き" : "テキスト"}
          </span>
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
