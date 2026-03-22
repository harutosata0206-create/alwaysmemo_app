import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, Monitor, Minus, Moon, Square, Sun, X, Copy } from "lucide-react";
import {
  SETTINGS_REQUEST_EVENT,
  SETTINGS_SYNC_EVENT,
  SETTINGS_UPDATE_EVENT,
  type LineSpacing,
  type SettingsPatch,
  type SettingsRequestPayload,
  type SettingsSnapshot,
  type SettingsSyncPayload,
} from "./lib/settingsBridge";
import "./App.css";

const HELP_URL = "https://alwaysmemo.pages.dev/help";
const TERMS_URL = "https://alwaysmemo.pages.dev/terms";
const PRIVACY_URL = "https://alwaysmemo.pages.dev/privacy";

function SettingsWindow() {
  const windowHandle = useMemo(() => WebviewWindow.getCurrent(), []);
  const currentLabel = windowHandle.label;
  const sourceLabel = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("source") ?? "main";
  }, []);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [settingsNav, setSettingsNav] = useState<
    "appearance" | "formatting" | "features" | "startup" | "about"
  >("appearance");
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [editorFontSizeInput, setEditorFontSizeInput] = useState("14");
  const settingsContentRef = useRef<HTMLDivElement | null>(null);

  const effectiveTheme = useMemo(() => {
    const themeMode = snapshot?.themeMode ?? "system";
    return themeMode === "system" ? (systemPrefersDark ? "dark" : "light") : themeMode;
  }, [snapshot?.themeMode, systemPrefersDark]);

  const syncWindowState = useCallback(async () => {
    try {
      const maximized = await windowHandle.isMaximized();
      setIsWindowMaximized(maximized);
    } catch (error) {
      console.error("Failed to sync settings window maximize state", error);
    }
  }, [windowHandle]);

  const requestSnapshot = useCallback(async () => {
    await windowHandle.emitTo<SettingsRequestPayload>(sourceLabel, SETTINGS_REQUEST_EVENT, {
      settingsLabel: currentLabel,
    });
  }, [currentLabel, sourceLabel, windowHandle]);

  const sendPatch = useCallback(
    async (patch: SettingsPatch) => {
      setSnapshot((current) => (current ? { ...current, ...patch } : current));
      if (patch.editorFontSizePx !== undefined) {
        setEditorFontSizeInput(String(patch.editorFontSizePx));
      }
      await windowHandle.emitTo(sourceLabel, SETTINGS_UPDATE_EVENT, {
        settingsLabel: currentLabel,
        patch,
      });
    },
    [currentLabel, sourceLabel, windowHandle],
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

  const jumpToSettingsSection = useCallback(
    (key: "appearance" | "formatting" | "features" | "startup" | "about") => {
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
    },
    [],
  );

  const commitEditorFontSize = useCallback(async () => {
    const currentValue = snapshot?.editorFontSizePx ?? 14;
    const parsed = Number.parseInt(editorFontSizeInput, 10);
    if (Number.isNaN(parsed)) {
      setEditorFontSizeInput(String(currentValue));
      return;
    }
    const clamped = Math.max(8, Math.min(72, parsed));
    setEditorFontSizeInput(String(clamped));
    await sendPatch({ editorFontSizePx: clamped });
  }, [editorFontSizeInput, sendPatch, snapshot?.editorFontSizePx]);

  const handleWindowDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (event.detail === 2) {
      void (async () => {
        if (await windowHandle.isMaximized()) {
          await windowHandle.unmaximize();
        } else {
          await windowHandle.maximize();
        }
        await syncWindowState();
      })();
      return;
    }
    void windowHandle.startDragging().catch((error) => {
      console.error("Failed to start dragging settings window", error);
    });
  }, [syncWindowState, windowHandle]);

  useEffect(() => {
    let unlistenSync: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    void windowHandle.listen<SettingsSyncPayload>(SETTINGS_SYNC_EVENT, ({ payload }) => {
      if (payload.sourceLabel !== sourceLabel) return;
      setSnapshot(payload.snapshot);
      setEditorFontSizeInput(String(payload.snapshot.editorFontSizePx));
    }).then((cleanup) => {
      unlistenSync = cleanup;
    }).catch((error) => {
      console.error("Failed to listen for settings sync", error);
    });

    void windowHandle.onResized(() => {
      void syncWindowState();
    }).then((cleanup) => {
      unlistenResize = cleanup;
    });

    void windowHandle.onMoved(() => {
      void syncWindowState();
    }).then((cleanup) => {
      unlistenMove = cleanup;
    });

    void windowHandle.onFocusChanged(({ payload }) => {
      if (!payload) return;
      void requestSnapshot();
    }).then((cleanup) => {
      unlistenFocus = cleanup;
    });

    void syncWindowState();
    void requestSnapshot();

    return () => {
      unlistenSync?.();
      unlistenResize?.();
      unlistenMove?.();
      unlistenFocus?.();
    };
  }, [requestSnapshot, sourceLabel, syncWindowState, windowHandle]);

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

  const previewFontSizePx = useMemo(() => {
    const parsed = Number.parseInt(editorFontSizeInput, 10);
    if (Number.isNaN(parsed)) return snapshot?.editorFontSizePx ?? 14;
    return Math.max(8, Math.min(72, parsed));
  }, [editorFontSizeInput, snapshot?.editorFontSizePx]);

  const previewLineHeight = useMemo(
    () => ((snapshot?.lineSpacing ?? "standard") === "relaxed" ? 1.45 : 1.15),
    [snapshot?.lineSpacing],
  );

  const openExternalPage = useCallback(async (url: string) => {
    try {
      await openUrl(url);
    } catch (error) {
      console.error("Failed to open external page", error);
    }
  }, []);

  if (!snapshot) {
    return (
      <div className={`app theme-${effectiveTheme}`}>
        <section className="settings-screen standalone">
          <div className="settings-drag-region" onPointerDown={handleWindowDragStart} />
          <div className="settings-window-controls">
            <button type="button" className="window-button" onClick={() => void windowHandle.minimize()} aria-label="Minimize">
              <Minus className="window-icon" strokeWidth={1.2} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="window-button"
              onClick={() => void (async () => {
                if (await windowHandle.isMaximized()) {
                  await windowHandle.unmaximize();
                } else {
                  await windowHandle.maximize();
                }
                await syncWindowState();
              })()}
              aria-label={isWindowMaximized ? "Restore" : "Maximize"}
            >
              {isWindowMaximized ? (
                <Copy className="window-icon" strokeWidth={1.2} aria-hidden="true" />
              ) : (
                <Square className="window-icon" strokeWidth={1.2} aria-hidden="true" />
              )}
            </button>
            <button type="button" className="window-button close" onClick={() => void windowHandle.close()} aria-label="Close">
              <X className="window-icon close-window-icon" strokeWidth={1.2} aria-hidden="true" />
            </button>
          </div>
          <div className="settings-window-loading">設定を読み込んでいます...</div>
        </section>
      </div>
    );
  }

  return (
    <div className={`app theme-${effectiveTheme} settings-window-root ${isWindowMaximized ? "window-maximized" : ""}`}>
      <section className="settings-screen standalone">
        <div className="settings-drag-region" onPointerDown={handleWindowDragStart} />
        <div className="settings-window-controls">
          <button type="button" className="window-button" onClick={() => void windowHandle.minimize()} aria-label="Minimize">
            <Minus className="window-icon" strokeWidth={1.2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="window-button"
            onClick={() => void (async () => {
              if (await windowHandle.isMaximized()) {
                await windowHandle.unmaximize();
              } else {
                await windowHandle.maximize();
              }
              await syncWindowState();
            })()}
            aria-label={isWindowMaximized ? "Restore" : "Maximize"}
          >
            {isWindowMaximized ? (
              <Copy className="window-icon" strokeWidth={1.2} aria-hidden="true" />
            ) : (
              <Square className="window-icon" strokeWidth={1.2} aria-hidden="true" />
            )}
          </button>
          <button type="button" className="window-button close" onClick={() => void windowHandle.close()} aria-label="Close">
            <X className="window-icon close-window-icon" strokeWidth={1.2} aria-hidden="true" />
          </button>
        </div>

        <div className="settings-layout settings-layout-standalone">
          <div className="settings-mobile-header">
            <div className="settings-brand">
              <div className="settings-brand-name">AlwaysMemo</div>
            </div>
          </div>
          <aside className="settings-sidebar">
            <div className="settings-brand">
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
                  <button type="button" className={`theme-card ${snapshot.themeMode === "light" ? "active" : ""}`} onClick={() => void sendPatch({ themeMode: "light" })}>
                    <span className="theme-icon"><Sun size={18} strokeWidth={1.8} aria-hidden="true" /></span>
                    <span>ライト</span>
                  </button>
                  <button type="button" className={`theme-card ${snapshot.themeMode === "dark" ? "active" : ""}`} onClick={() => void sendPatch({ themeMode: "dark" })}>
                    <span className="theme-icon"><Moon size={18} strokeWidth={1.8} aria-hidden="true" /></span>
                    <span>ダーク</span>
                  </button>
                  <button type="button" className={`theme-card ${snapshot.themeMode === "system" ? "active" : ""}`} onClick={() => void sendPatch({ themeMode: "system" })}>
                    <span className="theme-icon"><Monitor size={18} strokeWidth={1.8} aria-hidden="true" /></span>
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
                        onChange={(event) => setEditorFontSizeInput(event.target.value)}
                        onBlur={() => void commitEditorFontSize()}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void commitEditorFontSize();
                            event.currentTarget.blur();
                          }
                          if (event.key === "Escape") {
                            setEditorFontSizeInput(String(snapshot.editorFontSizePx));
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
                      value={snapshot.lineSpacing}
                      onChange={(event) => void sendPatch({ lineSpacing: event.target.value as LineSpacing })}
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
                        checked={snapshot.wrapAtRightEdge}
                        onChange={(event) => {
                          const anchor = event.currentTarget.closest(".settings-field-row") as HTMLElement | null;
                          keepSettingsViewport(anchor, async () => {
                            await sendPatch({ wrapAtRightEdge: event.target.checked });
                          });
                        }}
                      />
                      <span />
                    </label>
                  </div>
                  <div
                    className="settings-preview"
                    data-wrap={snapshot.wrapAtRightEdge ? "on" : "off"}
                    data-line-spacing={snapshot.lineSpacing}
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
                      checked={snapshot.alwaysOnTop}
                      onChange={(event) => {
                        const anchor = event.currentTarget.closest(".feature-row") as HTMLElement | null;
                        keepSettingsViewport(anchor, async () => {
                          await sendPatch({ alwaysOnTop: event.target.checked });
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
                      checked={snapshot.useGlobalShortcuts}
                      onChange={(event) => {
                        const anchor = event.currentTarget.closest(".feature-row") as HTMLElement | null;
                        keepSettingsViewport(anchor, async () => {
                          await sendPatch({ useGlobalShortcuts: event.target.checked });
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
                      <input type="radio" name="session" checked={snapshot.sessionBehavior === "restore"} onChange={() => void sendPatch({ sessionBehavior: "restore" })} />
                      前回の状態を復元
                    </label>
                    <label>
                      <input type="radio" name="session" checked={snapshot.sessionBehavior === "new"} onChange={() => void sendPatch({ sessionBehavior: "new" })} />
                      常に新規で開始
                    </label>
                  </div>
                  <div className="startup-card">
                    <strong>ファイルの開き方</strong>
                    <label>
                      <input type="radio" name="open" checked={snapshot.fileOpenBehavior === "existing"} onChange={() => void sendPatch({ fileOpenBehavior: "existing" })} />
                      既存ウィンドウに追加
                    </label>
                    <label>
                      <input type="radio" name="open" checked={snapshot.fileOpenBehavior === "new_window"} onChange={() => void sendPatch({ fileOpenBehavior: "new_window" })} />
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
                  <span>設定ウィンドウ</span>
                  <span>MIT ライセンス</span>
                </div>
                <div className="about-links" aria-label="AlwaysMemo の関連ページ">
                  <button
                    type="button"
                    className="about-link-button"
                    onClick={() => {
                      void openExternalPage(HELP_URL);
                    }}
                  >
                    <span>ヘルプ</span>
                    <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="about-link-button"
                    onClick={() => {
                      void openExternalPage(TERMS_URL);
                    }}
                  >
                    <span>利用規約</span>
                    <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="about-link-button"
                    onClick={() => {
                      void openExternalPage(PRIVACY_URL);
                    }}
                  >
                    <span>プライバシー</span>
                    <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default SettingsWindow;
