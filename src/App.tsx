import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import "./App.css";

const MIN_WINDOW_WIDTH = 280;
const MIN_WINDOW_HEIGHT = 200;
const STORAGE_KEY = "alwaysmemo-state";

type Tab = {
  id: string;
  title: string;
  content: string;
  filePath?: string | null;
};

const DEFAULT_TITLE_REGEX = /^メモ\s+\d+$/;

type SnapPosition = "left" | "right" | null;

type PersistedState = {
  tabs: Tab[];
  activeTabId: string | null;
  alwaysOnTop: boolean;
  snap: SnapPosition;
  useGlobalShortcuts: boolean;
};

function App() {
  const [useGlobalShortcuts, setUseGlobalShortcuts] = useState(true);
  const [alwaysOnTop, setAlwaysOnTopState] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "initial", title: "メモ 1", content: "" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("initial");
  const [snap, setSnap] = useState<SnapPosition>(null);
  const toggleLockRef = useRef(0);
  const tabsScrollerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [showTabArrows, setShowTabArrows] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(0);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const savedTabsRef = useRef<Record<string, { title: string; content: string }>>({});
  const [, setSavedVersion] = useState(0);
  const [openMenu, setOpenMenu] = useState<"file" | "edit" | "view" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const fileMenuRef = useRef<HTMLDivElement | null>(null);
  const originalWindowSizeRef = useRef<LogicalSize | null>(null);
  const expandedWindowRef = useRef(false);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const windowHandle = getCurrentWindow();
  const activeContent = activeTab?.content ?? "";

  const cursorPosition = useMemo(() => {
    const safeIndex = Math.min(cursorIndex, activeContent.length);
    const before = activeContent.slice(0, safeIndex);
    const lines = before.split(/\r?\n/);
    return {
      line: Math.max(lines.length, 1),
      column: (lines[lines.length - 1]?.length ?? 0) + 1,
    };
  }, [activeContent, cursorIndex]);

  const lineEndingLabel = useMemo(() => {
    if (activeContent.includes("\r\n")) return "Windows (CRLF)";
    return "LF";
  }, [activeContent]);

  const updateCursorIndex = useCallback((event: React.SyntheticEvent<HTMLTextAreaElement>) => {
    setCursorIndex(event.currentTarget.selectionStart ?? 0);
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
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    },
    [activeTabId, alwaysOnTop, snap, useGlobalShortcuts],
  );

  const closeMenus = useCallback(() => setOpenMenu(null), []);

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
      savedTabsRef.current = {
        ...savedTabsRef.current,
        [id]: { title, content: opened.contents },
      };
      setSavedVersion((prev) => prev + 1);
      setTabs((prev) => {
        const next = [...prev, { id, title, content: opened.contents, filePath: opened.path }];
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
  }, [closeMenus, persistState, tabs]);

  const saveActiveTabAs = useCallback(async () => {
    if (!activeTab) return;
    try {
      setStatus("Opening save dialog...");
      const suggested = activeTab.title.trim() || "memo.txt";
      const defaultPath = suggested.includes(".") ? suggested : `${suggested}.txt`;
      let resolvedPath: string | null = null;
      let dialogFailed = false;
      try {
        const picked = await save({
          defaultPath,
          filters: [{ name: "Text", extensions: ["txt", "md"] }],
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
      if (!resolvedPath) {
        setStatus("Save dialog returned no path");
        return;
      }
      setStatus(`Saving to ${resolvedPath}...`);
      await invoke("write_text_file", { path: resolvedPath, contents: activeTab.content });
      const nextTitle = getFileNameFromPath(resolvedPath);
      const nextTabs = tabs.map((tab) =>
        tab.id === activeTab.id
          ? { ...tab, title: nextTitle, filePath: resolvedPath }
          : tab,
      );
      setTabs(nextTabs);
      savedTabsRef.current = {
        ...savedTabsRef.current,
        [activeTab.id]: { title: nextTitle, content: activeTab.content },
      };
      setSavedVersion((prev) => prev + 1);
      persistState(nextTabs);
      setStatus(`Saved ${nextTitle}`);
      closeMenus();
    } catch (error) {
      console.error(error);
      setStatus(`Failed to save file: ${String(error)}`);
    }
  }, [activeTab, closeMenus]);

  const saveActiveTab = useCallback(async () => {
    if (!activeTab) return;
    if (!activeTab.filePath) {
      await saveActiveTabAs();
      return;
    }
    try {
      setStatus(`Saving to ${activeTab.filePath}...`);
      await invoke("write_text_file", {
        path: activeTab.filePath,
        contents: activeTab.content,
      });
      savedTabsRef.current = {
        ...savedTabsRef.current,
        [activeTab.id]: { title: activeTab.title, content: activeTab.content },
      };
      setSavedVersion((prev) => prev + 1);
      persistState(tabs);
      setStatus(`Saved ${activeTab.title}`);
      closeMenus();
    } catch (error) {
      console.error(error);
      setStatus(`Failed to save file: ${String(error)}`);
    }
  }, [activeTab, closeMenus, persistState, saveActiveTabAs, tabs]);

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
          invoke("write_text_file", { path: tab.filePath, contents: tab.content }),
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
  }, [closeMenus, persistState, tabs]);

  const closeActiveTab = useCallback(() => {
    if (!activeTab) return;
    void removeTab(activeTab.id);
    closeMenus();
  }, [activeTab, closeMenus]);

  const openNewWindow = useCallback(async () => {
    try {
      const size = await windowHandle.outerSize();
      const label = `alwaysmemo-${crypto.randomUUID()}`;
      await windowHandle.createWindow({
        label,
        url: "/",
        width: size.width,
        height: size.height,
        decorations: false,
        resizable: true,
        title: "alwaysmemo",
      });
      closeMenus();
    } catch (error) {
      console.error(error);
      setStatus("Failed to open new window");
    }
  }, [closeMenus, windowHandle]);

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
    const textarea = textareaRef.current;
    if (!textarea) return;
    try {
      const maxWidth = window.screen?.availWidth ?? window.innerWidth;
      const maxHeight = window.screen?.availHeight ?? window.innerHeight;
      const computed = window.getComputedStyle(textarea);
      const font = `${computed.fontStyle} ${computed.fontVariant} ${computed.fontWeight} ${computed.fontSize} / ${computed.lineHeight} ${computed.fontFamily}`;
      const lines = (textarea.value ?? "").split(/\r?\n/);
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
        : textarea.scrollWidth;

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

      const chromeWidth = window.innerWidth - textarea.clientWidth;
      const chromeHeight = window.innerHeight - textarea.clientHeight;

      const nextWidth = Math.max(
        MIN_WINDOW_WIDTH,
        Math.round(targetTextWidth + chromeWidth),
      );
      const nextHeight = Math.max(
        MIN_WINDOW_HEIGHT,
        Math.round(targetTextHeight + chromeHeight),
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
        const current = await invoke<boolean>("get_always_on_top");
        setAlwaysOnTopState(current);
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as PersistedState;
          const restoredTabs = parsed.tabs.length
            ? parsed.tabs
            : [{ id: "initial", title: "メモ 1", content: "" }];
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
          setAlwaysOnTopState(parsed.alwaysOnTop ?? current);
          if (parsed.alwaysOnTop) {
            await invoke("set_always_on_top", { value: true });
          }
          if (parsed.snap === "left") {
            await snapLeft();
          } else if (parsed.snap === "right") {
            await snapRight();
          }
        } else {
          savedTabsRef.current = {
            initial: { title: "メモ 1", content: "" },
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
    if (openMenu !== "file") {
      if (expandedWindowRef.current && originalWindowSizeRef.current) {
        void windowHandle.setSize(originalWindowSizeRef.current);
        expandedWindowRef.current = false;
        originalWindowSizeRef.current = null;
      }
      return;
    }

    if (expandedWindowRef.current) return;

    const frame = window.requestAnimationFrame(async () => {
      const panel = fileMenuRef.current;
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

  const addTab = () => {
    const id = crypto.randomUUID();
    const newTab: Tab = { id, title: `メモ ${tabs.length + 1}`, content: "" };
    savedTabsRef.current = {
      ...savedTabsRef.current,
      [id]: { title: newTab.title, content: newTab.content },
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  };

  const removeTab = async (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (isTabDirty(tab)) {
      let confirmed = false;
      try {
        confirmed = await confirm(`「${tab.title}」を削除しますか？`);
      } catch (error) {
        console.error("confirm dialog failed", error);
        confirmed = window.confirm(`「${tab.title}」を削除しますか？`);
      }
      if (!confirmed) return;
    }
    setTabs((prev) => {
      const nextTabs = prev.filter((t) => t.id !== id);
      if (nextTabs.length === 0) {
        const fallback: Tab = { id: "initial", title: "メモ 1", content: "" };
        setActiveTabId(fallback.id);
        return [fallback];
      }
      if (activeTabId === id) {
        setActiveTabId(nextTabs[0]?.id ?? nextTabs[0].id);
      }
      return nextTabs;
    });
  };

  const renameTab = (id: string, title: string) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  };

  const updateContent = (content: string) => {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, content } : t)),
    );
  };

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
    const trimmed = tab.content.trimStart();
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
                        void removeTab(tab.id);
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
            <div className="menu-wrapper">
              <button
                type="button"
                className={`menu-button ${openMenu === "edit" ? "active" : ""}`}
                onClick={() => setOpenMenu((prev) => (prev === "edit" ? null : "edit"))}
              >
                編集
              </button>
              {openMenu === "edit" ? (
                <div className="menu-panel" onMouseDown={(event) => event.stopPropagation()}>
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>元に戻す</span>
                    <span className="menu-shortcut">Ctrl+Z</span>
                  </button>
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>やり直す</span>
                    <span className="menu-shortcut">Ctrl+Shift+Z</span>
                  </button>
                  <div className="menu-divider" />
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>切り取り</span>
                    <span className="menu-shortcut">Ctrl+X</span>
                  </button>
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>コピー</span>
                    <span className="menu-shortcut">Ctrl+C</span>
                  </button>
                  <button type="button" className="menu-item disabled" aria-disabled="true">
                    <span>貼り付け</span>
                    <span className="menu-shortcut">Ctrl+V</span>
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
          <button type="button" className="icon-button overflow" aria-label="More">
            ⋯
          </button>
          <div className="format-group">
            <button type="button" className="chip">
              H1
            </button>
            <button type="button" className="chip">
              ≡
            </button>
            <button type="button" className="chip">
              B
            </button>
            <button type="button" className="chip">
              …
            </button>
          </div>
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

          <textarea
            ref={textareaRef}
            value={activeTab?.content ?? ""}
            onChange={(event) => {
              updateContent(event.target.value);
              updateCursorIndex(event);
            }}
            onSelect={updateCursorIndex}
            onKeyUp={updateCursorIndex}
            onClick={updateCursorIndex}
            placeholder="ここにメモを書く"
          />
        </div>
      </section>

      <div className="bottom-bar">
        <span className="bottom-item">行 {cursorPosition.line}, 列 {cursorPosition.column}</span>
        <span className="bottom-item">{activeContent.length} 文字</span>
        <span className="bottom-item">テキスト</span>
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
