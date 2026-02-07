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

type SaveFormatChoice = "markdown" | "text" | "cancel";
type SaveLossyChoice = "markdown" | "text" | "cancel";

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
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [showTabArrows, setShowTabArrows] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const savedTabsRef = useRef<Record<string, { title: string; content: string }>>({});
  const [, setSavedVersion] = useState(0);
  const [openMenu, setOpenMenu] = useState<"file" | "edit" | "view" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const editMenuRef = useRef<HTMLDivElement | null>(null);
  const editMenuWrapperRef = useRef<HTMLDivElement | null>(null);
  const [editMenuLeft, setEditMenuLeft] = useState<number | null>(null);
  const [showFormatMenu, setShowFormatMenu] = useState(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [tableHover, setTableHover] = useState({ rows: 0, cols: 0 });
  const originalWindowSizeRef = useRef<LogicalSize | null>(null);
  const expandedWindowRef = useRef(false);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const formatGroupRef = useRef<HTMLDivElement | null>(null);
  const overflowMenuRef = useRef<HTMLDivElement | null>(null);
  const [showHeadingMenu, setShowHeadingMenu] = useState(false);
  const [showListMenu, setShowListMenu] = useState(false);
  const [saveFormatPromptOpen, setSaveFormatPromptOpen] = useState(false);
  const saveFormatResolverRef = useRef<((choice: SaveFormatChoice) => void) | null>(null);
  const [saveLossyPromptOpen, setSaveLossyPromptOpen] = useState(false);
  const saveLossyResolverRef = useRef<((choice: SaveLossyChoice) => void) | null>(null);
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

  const cursorPosition = useMemo(() => {
    const safeIndex = Math.min(cursorIndex, activePlainText.length);
    const before = activePlainText.slice(0, safeIndex);
    const lines = before.split(/\r?\n/);
    return {
      line: Math.max(lines.length, 1),
      column: (lines[lines.length - 1]?.length ?? 0) + 1,
    };
  }, [activePlainText, cursorIndex]);

  const lineEndingLabel = useMemo(() => {
    if (activePlainText.includes("\r\n")) return "Windows (CRLF)";
    return "LF";
  }, [activePlainText]);

  const updateCursorIndex = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      setCursorIndex(0);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;
    const preRange = range.cloneRange();
    preRange.selectNodeContents(editor);
    preRange.setEnd(range.startContainer, range.startOffset);
    const fragment = preRange.cloneContents();
    const beforeText = nodeToPlainText(fragment).replace(/\u00a0/g, " ");
    setCursorIndex(beforeText.length);
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

  const closeMenus = useCallback(() => setOpenMenu(null), []);
  const closeFormatMenu = useCallback(() => {
    setShowFormatMenu(false);
    setShowTablePicker(false);
  }, []);
  const closeOverflowMenu = useCallback(() => {
    setShowOverflowMenu(false);
    setShowTablePicker(false);
  }, []);
  const closeHeadingMenu = useCallback(() => {
    setShowHeadingMenu(false);
  }, []);
  const closeListMenu = useCallback(() => {
    setShowListMenu(false);
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

  const htmlToMarkdown = useCallback((html: string) => {
    const container = document.createElement("div");
    container.innerHTML = html;

    const toMarkdown = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? "";
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();
      const childText = Array.from(el.childNodes).map(toMarkdown).join("");

      if (tag === "br") return "\n";
      if (tag === "strong" || tag === "b") return `**${childText}**`;
      if (tag === "div" || tag === "p") return `${childText}\n`;
      return childText;
    };

    return Array.from(container.childNodes)
      .map(toMarkdown)
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
  }, []);

  const hasRichFormatting = useCallback((html: string) => {
    const container = document.createElement("div");
    container.innerHTML = html;
    if (container.querySelector("strong, b, em, i, u, a, table, thead, tbody, tr, td, th, ul, ol, li, h1, h2, h3, h4, h5, h6")) {
      return true;
    }
    return Array.from(container.querySelectorAll<HTMLElement>("span"))
      .some((el) => {
        const weight = el.style.fontWeight;
        const style = el.style.fontStyle;
        const deco = el.style.textDecorationLine || el.style.textDecoration;
        return (
          (weight && weight !== "normal") ||
          (style && style !== "normal") ||
          (deco && deco !== "none")
        );
      });
  }, []);

  const chooseSaveFormat = useCallback(() => {
    if (saveFormatResolverRef.current) {
      saveFormatResolverRef.current("cancel");
      saveFormatResolverRef.current = null;
    }
    setSaveFormatPromptOpen(true);
    return new Promise<SaveFormatChoice>((resolve) => {
      saveFormatResolverRef.current = resolve;
    });
  }, []);

  const resolveSaveFormat = useCallback((choice: SaveFormatChoice) => {
    setSaveFormatPromptOpen(false);
    const resolver = saveFormatResolverRef.current;
    saveFormatResolverRef.current = null;
    if (resolver) resolver(choice);
  }, []);

  const chooseLossySave = useCallback(() => {
    if (saveLossyResolverRef.current) {
      saveLossyResolverRef.current("cancel");
      saveLossyResolverRef.current = null;
    }
    setSaveLossyPromptOpen(true);
    return new Promise<SaveLossyChoice>((resolve) => {
      saveLossyResolverRef.current = resolve;
    });
  }, []);

  const resolveLossySave = useCallback((choice: SaveLossyChoice) => {
    setSaveLossyPromptOpen(false);
    const resolver = saveLossyResolverRef.current;
    saveLossyResolverRef.current = null;
    if (resolver) resolver(choice);
  }, []);

  const pickSavePath = useCallback(async (format: "markdown" | "text", suggested: string) => {
    const withExt = suggested.includes(".")
      ? suggested
      : format === "markdown"
        ? `${suggested}.md`
        : `${suggested}.txt`;
    const defaultPath = withExt;
    let resolvedPath: string | null = null;
    let dialogFailed = false;
    const filters =
      format === "markdown"
        ? [
            { name: "Markdown", extensions: ["md"] },
            { name: "Text", extensions: ["txt"] },
          ]
        : [
            { name: "Text", extensions: ["txt"] },
            { name: "Markdown", extensions: ["md"] },
          ];
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

  const saveTabAs = useCallback(async (tab: Tab, forcedFormat?: "markdown" | "text") => {
    try {
      setStatus("Opening save dialog...");
      const format =
        forcedFormat ??
        (hasRichFormatting(tab.content) ? await chooseSaveFormat() : "text");
      if (format === "cancel") {
        setStatus("Save canceled");
        return false;
      }
      const suggested = tab.title.trim() || "memo";
      const resolvedPath = await pickSavePath(format, suggested);
      if (!resolvedPath) {
        setStatus("Save dialog returned no path");
        return false;
      }
      setStatus(`Saving to ${resolvedPath}...`);
      await invoke("write_text_file", {
        path: resolvedPath,
        contents:
          format === "markdown"
            ? htmlToMarkdown(tab.content)
            : htmlToText(tab.content),
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
    chooseSaveFormat,
    closeMenus,
    getFileNameFromPath,
    hasRichFormatting,
    htmlToMarkdown,
    htmlToText,
    getPathMap,
    pickSavePath,
    persistState,
    setPathMap,
  ]);

  const saveActiveTabAs = useCallback(async (forcedFormat?: "markdown" | "text") => {
    if (!activeTab) return;
    await saveTabAs(activeTab, forcedFormat);
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
      const isMarkdown = resolvedPath.toLowerCase().endsWith(".md");
      if (!isMarkdown && hasRichFormatting(tab.content)) {
        const choice = await chooseLossySave();
        if (choice === "cancel") return false;
        if (choice === "markdown") {
          return await saveTabAs(tab, "markdown");
        }
      }
      setStatus(`Saving to ${resolvedPath}...`);
      await invoke("write_text_file", {
        path: resolvedPath,
        contents: isMarkdown ? htmlToMarkdown(tab.content) : htmlToText(tab.content),
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
    chooseLossySave,
    closeMenus,
    htmlToText,
    htmlToMarkdown,
    hasRichFormatting,
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
            contents:
              tab.filePath?.toLowerCase().endsWith(".md")
                ? htmlToMarkdown(tab.content)
                : htmlToText(tab.content),
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
  }, [closeMenus, htmlToMarkdown, htmlToText, persistState, tabs]);

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
    const scroller = tabsScrollerRef.current;
    if (!scroller) {
      setShowTabArrows(false);
      return;
    }
    const updateOverflow = () => {
      setShowTabArrows(scroller.scrollWidth > scroller.clientWidth + 1);
    };
    updateOverflow();
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [tabs]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === "KeyS") {
        event.preventDefault();
        void saveActiveTab();
        return;
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
    if (!showFormatMenu && !showOverflowMenu && !showHeadingMenu && !showListMenu) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (formatGroupRef.current?.contains(target)) return;
      if (overflowMenuRef.current?.contains(target)) return;
      closeFormatMenu();
      closeOverflowMenu();
      closeHeadingMenu();
      closeListMenu();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [closeFormatMenu, closeHeadingMenu, closeListMenu, closeOverflowMenu, showFormatMenu, showHeadingMenu, showListMenu, showOverflowMenu]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".format-group")) return;
      setShowFormatMenu(false);
      setShowHeadingMenu(false);
      setShowListMenu(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, []);

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
    if (openMenu !== "file" && openMenu !== "edit") {
      if (expandedWindowRef.current && originalWindowSizeRef.current) {
        void windowHandle.setSize(originalWindowSizeRef.current);
        expandedWindowRef.current = false;
        originalWindowSizeRef.current = null;
      }
      return;
    }

    if (expandedWindowRef.current) return;

    const frame = window.requestAnimationFrame(async () => {
      const panel = openMenu === "file" ? fileMenuRef.current : editMenuRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const overflowCss = rect.bottom - window.innerHeight;
      if (overflowCss <= 0) return;

      try {
        if (!originalWindowSizeRef.current) {
          originalWindowSizeRef.current = new LogicalSize(
            window.innerWidth,
            window.innerHeight,
          );
        }
        const base = originalWindowSizeRef.current;
        const maxHeight = window.screen?.availHeight ?? base.height;
        const nextHeight = Math.min(base.height + overflowCss + 8, maxHeight);

        if (nextHeight > base.height) {
          expandedWindowRef.current = true;
          await windowHandle.setSize(new LogicalSize(base.width, nextHeight));
        }
      } catch (error) {
        console.error("Failed to expand window for menu", error);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [openMenu, windowHandle]);

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

  const addTab = () => {
    const id = crypto.randomUUID();
    const newTab: Tab = { id, title: "タイトルなし", content: "" };
    savedTabsRef.current = {
      ...savedTabsRef.current,
      [id]: { title: newTab.title, content: newTab.content },
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  };

  const performRemoveTab = useCallback((id: string) => {
    setTabs((prev) => {
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
  }, [activeTabId]);

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

  const toggleBold = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand("bold");
    updateContent(editor.innerHTML);
    updateCursorIndex();
  }, [updateContent, updateCursorIndex]);

  const applyHeading = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand("formatBlock", false, "h1");
    updateContent(editor.innerHTML);
    updateCursorIndex();
  }, [updateContent, updateCursorIndex]);

  const applyHeadingLevel = useCallback((level: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const tag = level >= 1 && level <= 6 ? `h${level}` : "p";
    document.execCommand("formatBlock", false, tag);
    updateContent(editor.innerHTML);
    updateCursorIndex();
  }, [updateContent, updateCursorIndex]);

  const toggleBulletedList = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand("insertUnorderedList");
    updateContent(editor.innerHTML);
    updateCursorIndex();
  }, [updateContent, updateCursorIndex]);

  const toggleOrderedList = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand("insertOrderedList");
    updateContent(editor.innerHTML);
    updateCursorIndex();
  }, [updateContent, updateCursorIndex]);

  const toggleItalic = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand("italic");
    updateContent(editor.innerHTML);
    updateCursorIndex();
  }, [updateContent, updateCursorIndex]);

  const insertLink = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const url = window.prompt("リンク先URLを入力");
    if (!url) return;
    editor.focus();
    document.execCommand("createLink", false, url);
    updateContent(editor.innerHTML);
    updateCursorIndex();
  }, [updateContent, updateCursorIndex]);

  const insertTableWithSize = useCallback(
    (rows: number, cols: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const body = Array.from({ length: rows })
        .map(
          () =>
            `<tr>${Array.from({ length: cols })
              .map(() => "<td>&nbsp;</td>")
              .join("")}</tr>`,
        )
        .join("");
      const tableHtml = `<table class="memo-table"><tbody>${body}</tbody></table>`;
      document.execCommand("insertHTML", false, tableHtml);
      updateContent(editor.innerHTML);
      updateCursorIndex();
    },
    [updateContent, updateCursorIndex],
  );

  const clearFormatting = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    const anchorElement =
      anchorNode?.nodeType === Node.ELEMENT_NODE
        ? (anchorNode as Element)
        : anchorNode?.parentElement ?? null;
    const listAncestor = anchorElement?.closest("ol, ul");
    if (listAncestor) {
      const isOrdered = listAncestor.tagName.toLowerCase() === "ol";
      document.execCommand(isOrdered ? "insertOrderedList" : "insertUnorderedList");
    }
    document.execCommand("removeFormat");
    document.execCommand("unlink");
    document.execCommand("formatBlock", false, "p");
    updateContent(editor.innerHTML);
    updateCursorIndex();
  }, [updateContent, updateCursorIndex]);

  const runEditorCommand = useCallback((command: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command);
    window.requestAnimationFrame(() => {
      updateContent(editor.innerHTML);
      updateCursorIndex();
    });
  }, [updateContent, updateCursorIndex]);

  const pasteFromClipboard = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
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
  }, [updateContent, updateCursorIndex]);

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

  const scrollTabs = (direction: -1 | 1) => {
    const scroller = tabsScrollerRef.current;
    if (!scroller) return;
    scroller.scrollBy({ left: direction * 110, behavior: "smooth" });
  };

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
        <div className="titlebar-row top" data-tauri-drag-region>
          <div className="tabs-area" data-tauri-drag-region>
            <div className="tabs-bar" data-tauri-drag-region>
              {showTabArrows ? (
                <button
                  type="button"
                  className="tab-scroll-button"
                  onClick={() => scrollTabs(-1)}
                  aria-label="Scroll tabs left"
                  data-tauri-drag-region="false"
                >
                  ◀
                </button>
              ) : null}
              <div className="tabs" ref={tabsScrollerRef} data-tauri-drag-region>
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
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
              {showTabArrows ? (
                <button
                  type="button"
                  className="tab-scroll-button"
                  onClick={() => scrollTabs(1)}
                  aria-label="Scroll tabs right"
                  data-tauri-drag-region="false"
                >
                  ▶
                </button>
              ) : null}
            </div>
            <button
              className="add-tab"
              onClick={addTab}
              title="新規タブ"
              data-tauri-drag-region="false"
            >
              ＋
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
                className={`menu-button ${openMenu === "file" ? "active" : ""}`}
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
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>新しいマークダウン タブ</span>
                  </button>
                  <div className="menu-divider" />
                  <button type="button" className="menu-item" onClick={openFilePicker}>
                    <span>開く</span>
                    <span className="menu-shortcut">Ctrl+O</span>
                  </button>
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>新着順</span>
                    <span className="menu-shortcut">›</span>
                  </button>
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
                  <button type="button" className="menu-item" onClick={() => { window.print(); closeMenus(); }}>
                    <span>印刷</span>
                    <span className="menu-shortcut">Ctrl+P</span>
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
                  <button type="button" className="menu-item" onClick={() => { runEditorCommand("delete"); closeMenus(); }}>
                    <span>削除</span>
                    <span className="menu-shortcut">Del</span>
                  </button>
                  <div className="menu-divider" />
                  <button type="button" className="menu-item" onClick={() => { clearFormatting(); closeMenus(); }}>
                    <span>書式設定のクリア</span>
                  </button>
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>Bing で定義</span>
                    <span className="menu-shortcut">Ctrl+E</span>
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
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      runEditorCommand("selectAll");
                      closeMenus();
                    }}
                  >
                    <span>すべて選択</span>
                    <span className="menu-shortcut">Ctrl+A</span>
                  </button>
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>日付と時刻</span>
                    <span className="menu-shortcut">F5</span>
                  </button>
                  <div className="menu-divider" />
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>フォント</span>
                  </button>
                </div>
              ) : null}
            </div>
            <div className="menu-wrapper">
              <button
                type="button"
                className={`menu-button ${openMenu === "view" ? "active" : ""}`}
                onClick={() => setOpenMenu((prev) => (prev === "view" ? null : "view"))}
              >
                表示
              </button>
              {openMenu === "view" ? (
                <div className="menu-panel" onMouseDown={(event) => event.stopPropagation()}>
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>ズームイン</span>
                    <span className="menu-shortcut">Ctrl++</span>
                  </button>
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>ズームアウト</span>
                    <span className="menu-shortcut">Ctrl+-</span>
                  </button>
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>実際のサイズ</span>
                    <span className="menu-shortcut">Ctrl+0</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
          <div className="format-overflow" ref={overflowMenuRef}>
            <button
              type="button"
              className="icon-button overflow"
              aria-label="More"
              onClick={() => setShowOverflowMenu((prev) => !prev)}
            >
              ⋯
            </button>
            {showOverflowMenu ? (
              <div className="format-menu overflow-menu">
                <button type="button" className="format-item" onClick={() => { applyHeading(); closeOverflowMenu(); }}>
                  見出し 1
                </button>
                <button type="button" className="format-item" onClick={() => { toggleBulletedList(); closeOverflowMenu(); }}>
                  箇条書き
                </button>
                <button type="button" className="format-item" onClick={() => { toggleOrderedList(); closeOverflowMenu(); }}>
                  番号付きリスト
                </button>
                <button type="button" className="format-item" onClick={() => { toggleBold(); closeOverflowMenu(); }}>
                  太字
                </button>
                <button
                  type="button"
                  className="format-item"
                  onClick={() => setShowTablePicker((prev) => !prev)}
                >
                  テーブルの作成
                </button>
                {showTablePicker ? (
                  <div className="table-picker">
                    <div className="table-picker-grid">
                      {Array.from({ length: 6 }).map((_, rowIndex) =>
                        Array.from({ length: 6 }).map((__, colIndex) => {
                          const rows = rowIndex + 1;
                          const cols = colIndex + 1;
                          const active =
                            rows <= tableHover.rows && cols <= tableHover.cols;
                          return (
                            <button
                              key={`overflow-${rows}-${cols}`}
                              type="button"
                              className={`table-cell ${active ? "active" : ""}`}
                              onMouseEnter={() => setTableHover({ rows, cols })}
                              onFocus={() => setTableHover({ rows, cols })}
                              onClick={() => {
                                insertTableWithSize(rows, cols);
                                setShowTablePicker(false);
                                closeOverflowMenu();
                              }}
                              aria-label={`${rows} x ${cols}`}
                            />
                          );
                        }),
                      )}
                    </div>
                    <div className="table-picker-label">
                      {tableHover.rows} x {tableHover.cols}
                    </div>
                  </div>
                ) : null}
                <button type="button" className="format-item" onClick={() => { insertLink(); closeOverflowMenu(); }}>
                  リンクの貼り付け
                </button>
                <button type="button" className="format-item" onClick={() => { clearFormatting(); closeOverflowMenu(); }}>
                  書式設定のクリア
                </button>
              </div>
            ) : null}
          </div>
          <div className="format-group" ref={formatGroupRef}>
            <button
              type="button"
              className="chip dropdown"
              onClick={() => setShowHeadingMenu((prev) => !prev)}
            >
              H1 <span className="chip-caret">▾</span>
            </button>
            {showHeadingMenu ? (
              <div className="format-menu heading-menu">
                <button type="button" className="format-item heading-item h1" onClick={() => { applyHeadingLevel(1); closeHeadingMenu(); }}>
                  タイトル
                </button>
                <button type="button" className="format-item heading-item h2" onClick={() => { applyHeadingLevel(2); closeHeadingMenu(); }}>
                  サブタイトル
                </button>
                <button type="button" className="format-item heading-item h3" onClick={() => { applyHeadingLevel(3); closeHeadingMenu(); }}>
                  見出し
                </button>
                <button type="button" className="format-item heading-item h4" onClick={() => { applyHeadingLevel(4); closeHeadingMenu(); }}>
                  小見出し
                </button>
                <button type="button" className="format-item heading-item h5" onClick={() => { applyHeadingLevel(5); closeHeadingMenu(); }}>
                  セクション
                </button>
                <button type="button" className="format-item heading-item h6" onClick={() => { applyHeadingLevel(6); closeHeadingMenu(); }}>
                  サブセクション
                </button>
                <button type="button" className="format-item heading-item body" onClick={() => { applyHeadingLevel(0); closeHeadingMenu(); }}>
                  本文
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="chip dropdown"
              onClick={() => setShowListMenu((prev) => !prev)}
            >
              ≡ <span className="chip-caret">▾</span>
            </button>
            {showListMenu ? (
              <div className="format-menu list-menu">
                <button type="button" className="format-item" onClick={() => { toggleBulletedList(); closeListMenu(); }}>
                  箇条書き
                </button>
                <button type="button" className="format-item" onClick={() => { toggleOrderedList(); closeListMenu(); }}>
                  番号付きリスト
                </button>
              </div>
            ) : null}
            <button type="button" className="chip" onClick={toggleBold} aria-label="Bold">
              B
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => setShowFormatMenu((prev) => !prev)}
              aria-label="More formatting"
            >
              …
            </button>
            {showFormatMenu ? (
              <div className="format-menu">
                <button
                  type="button"
                  className="format-item"
                  onClick={() => setShowTablePicker((prev) => !prev)}
                >
                  テーブルの作成
                </button>
                {showTablePicker ? (
                  <div className="table-picker">
                    <div className="table-picker-grid">
                      {Array.from({ length: 6 }).map((_, rowIndex) =>
                        Array.from({ length: 6 }).map((__, colIndex) => {
                          const rows = rowIndex + 1;
                          const cols = colIndex + 1;
                          const active =
                            rows <= tableHover.rows && cols <= tableHover.cols;
                          return (
                            <button
                              key={`${rows}-${cols}`}
                              type="button"
                              className={`table-cell ${active ? "active" : ""}`}
                              onMouseEnter={() => setTableHover({ rows, cols })}
                              onFocus={() => setTableHover({ rows, cols })}
                              onClick={() => {
                                insertTableWithSize(rows, cols);
                                setShowTablePicker(false);
                                closeFormatMenu();
                              }}
                              aria-label={`${rows} x ${cols}`}
                            />
                          );
                        }),
                      )}
                    </div>
                    <div className="table-picker-label">
                      {tableHover.rows} x {tableHover.cols}
                    </div>
                  </div>
                ) : null}
                <button type="button" className="format-item" onClick={() => { insertLink(); closeFormatMenu(); }}>
                  リンクの貼り付け
                </button>
                <button type="button" className="format-item" onClick={() => { clearFormatting(); closeFormatMenu(); }}>
                  書式設定のクリア
                </button>
              </div>
            ) : null}
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

      <section className="card memo">
        <div className="editor">
          <div className="editor-header">
          </div>

          <div
            ref={editorRef}
            className="editor-body"
            contentEditable
            suppressContentEditableWarning
            data-placeholder="ここにメモを書く"
            onInput={(event) => {
              updateContent(event.currentTarget.innerHTML);
              updateCursorIndex();
            }}
            onKeyUp={updateCursorIndex}
            onMouseUp={updateCursorIndex}
            onClick={updateCursorIndex}
          />
        </div>
      </section>

      {saveFormatPromptOpen ? (
        <div className="format-choice-overlay" role="presentation">
          <div
            className="format-choice-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="format-choice-title"
            aria-describedby="format-choice-desc"
          >
            <h2 id="format-choice-title">
              書式設定を保持するためにマークダウンとして保存する
            </h2>
            <p id="format-choice-desc">
              これはテキストファイルです。太字や見出しなどの現在の書式設定を保持するには、
              マークダウンファイル(.md)として保存します。書式なしテキストファイルとして保存すると、
              すべての書式が失われます。
            </p>
            <div className="format-choice-actions">
              <button
                type="button"
                className="format-choice primary"
                onClick={() => resolveSaveFormat("markdown")}
              >
                マークダウンファイルとして...
              </button>
              <button
                type="button"
                className="format-choice"
                onClick={() => resolveSaveFormat("text")}
              >
                テキストファイルとして...
              </button>
              <button
                type="button"
                className="format-choice ghost"
                onClick={() => resolveSaveFormat("cancel")}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {saveLossyPromptOpen ? (
        <div className="format-choice-overlay" role="presentation">
          <div
            className="format-choice-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lossy-save-title"
            aria-describedby="lossy-save-desc"
          >
            <h2 id="lossy-save-title">書式付きの内容をテキストで上書き保存しますか？</h2>
            <p id="lossy-save-desc">
              このファイルはテキスト形式で保存されています。太字や表などの書式を保持するには、
              マークダウンファイル(.md)として保存してください。テキストで上書き保存すると、
              書式はすべて失われます。
            </p>
            <div className="format-choice-actions">
              <button
                type="button"
                className="format-choice primary"
                onClick={() => resolveLossySave("markdown")}
              >
                マークダウンとして保存...
              </button>
              <button
                type="button"
                className="format-choice"
                onClick={() => resolveLossySave("text")}
              >
                テキストで上書き保存
              </button>
              <button
                type="button"
                className="format-choice ghost"
                onClick={() => resolveLossySave("cancel")}
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

      <div className="bottom-bar">
        <span className="bottom-item">行 {cursorPosition.line}, 列 {cursorPosition.column}</span>
        <span className="bottom-item">{activePlainText.length} 文字</span>
        <span className="bottom-item">
          {activeTab && hasRichFormatting(activeTab.content) ? "書式付き" : "テキスト"}
        </span>
        <span className="bottom-item">100%</span>
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
    </div>
  );
}

export default App;
