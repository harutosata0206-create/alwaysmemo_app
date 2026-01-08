import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

const SHORTCUT_LABEL = "Ctrl + Alt +";
const STORAGE_KEY = "alwaysmemo-state";

type Tab = {
  id: string;
  title: string;
  content: string;
};

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
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [showTabArrows, setShowTabArrows] = useState(false);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null;
  const windowHandle = getCurrentWindow();

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

  const shortcutActions = useMemo(
    () => [
      { id: "alwaysOnTop", combo: "Ctrl+Alt+T", action: toggleAlwaysOnTop },
      { id: "snapLeft", combo: "Ctrl+Alt+Left", action: snapLeft },
      { id: "snapRight", combo: "Ctrl+Alt+Right", action: snapRight },
    ],
    [snapLeft, snapRight, toggleAlwaysOnTop],
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
        default:
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [snapLeft, snapRight, toggleAlwaysOnTop]);

  useEffect(() => {
    const state: PersistedState = {
      tabs,
      activeTabId,
      alwaysOnTop,
      snap,
      useGlobalShortcuts,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [activeTabId, alwaysOnTop, snap, tabs, useGlobalShortcuts]);

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

  const addTab = () => {
    const id = crypto.randomUUID();
    const newTab: Tab = { id, title: `メモ ${tabs.length + 1}`, content: "" };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
  };

  const removeTab = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (!window.confirm(`「${tab.title}」を削除しますか？`)) return;
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
    scroller.scrollBy({ left: direction * 180, behavior: "smooth" });
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
                    <span className="tab-title">{tab.title}</span>
                    <span
                      className="tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        removeTab(tab.id);
                      }}
                      data-tauri-drag-region="false"
                    >
                      ×
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
              −
            </button>
            <button
              type="button"
              className="window-button"
              onClick={toggleMaximizeWindow}
              aria-label="Maximize"
              data-tauri-drag-region="false"
            >
              □
            </button>
            <button
              type="button"
              className="window-button close"
              onClick={closeWindow}
              aria-label="Close"
              data-tauri-drag-region="false"
            >
              ×
            </button>
          </div>
        </div>
        <div className="titlebar-row toolbar">
          <div className="menu-group">
            <button type="button" className="menu-button">
              ファイル
            </button>
            <button type="button" className="menu-button">
              編集
            </button>
            <button type="button" className="menu-button">
              表示
            </button>
          </div>
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
            <button type="button" className="icon-button" aria-label="Theme">
              ◎
            </button>
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
            value={activeTab?.content ?? ""}
            onChange={(event) => updateContent(event.target.value)}
            placeholder="ここにメモを書く"
          />
        </div>
      </section>

      <section className="card shortcuts">
        <div className="shortcut-row">
          <div className="keys">{SHORTCUT_LABEL} T</div>
          <div className="label">Toggle always on top</div>
          <button type="button" onClick={() => void toggleAlwaysOnTop()}>
            Run
          </button>
        </div>
        <div className="shortcut-row">
          <div className="keys">{SHORTCUT_LABEL} Left</div>
          <div className="label">Snap to top-left</div>
          <button type="button" onClick={() => void snapLeft()}>
            Run
          </button>
        </div>
        <div className="shortcut-row">
          <div className="keys">{SHORTCUT_LABEL} Right</div>
          <div className="label">Snap to top-right</div>
          <button type="button" onClick={() => void snapRight()}>
            Run
          </button>
        </div>
        <div className="actions inline">
          <button type="button" onClick={() => void setAlwaysOnTop(true)}>
            Force ON
          </button>
          <button type="button" onClick={() => void setAlwaysOnTop(false)}>
            Force OFF
          </button>
        </div>
      </section>

      <section className="card settings">
        <div className="settings-row">
          <div className="status">
            Always on top: <span className={alwaysOnTop ? "on" : "off"}>{alwaysOnTop ? "ON" : "OFF"}</span>
          </div>
          <div className="toggles">
            <label className="toggle">
              <input
                type="checkbox"
                checked={alwaysOnTop}
                onChange={(event) => void setAlwaysOnTop(event.target.checked)}
              />
              <span>Always on top</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={useGlobalShortcuts}
                onChange={(event) => setUseGlobalShortcuts(event.target.checked)}
              />
              <span>Global shortcuts</span>
            </label>
          </div>
        </div>
      </section>

      {status ? <div className="status-bar">{status}</div> : null}
    </div>
  );
}

export default App;
