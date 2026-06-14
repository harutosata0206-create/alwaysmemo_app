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
  type LanguagePreference,
  type LineSpacing,
  type SettingsPatch,
  type SettingsRequestPayload,
  type SettingsSnapshot,
  type SettingsSyncPayload,
} from "./lib/settingsBridge";
import { useMessages } from "./lib/i18n";
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
    "language" | "appearance" | "formatting" | "features" | "startup" | "about"
  >("language");
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [editorFontSizeInput, setEditorFontSizeInput] = useState("14");
  const settingsContentRef = useRef<HTMLDivElement | null>(null);
  const { messages } = useMessages(snapshot?.languagePreference ?? "system");

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
    (key: "language" | "appearance" | "formatting" | "features" | "startup" | "about") => {
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

  useEffect(() => {
    void windowHandle.setTitle(messages.app.windowTitles.settings).catch((error) => {
      console.error("Failed to update settings window title", error);
    });
  }, [messages.app.windowTitles.settings, windowHandle]);

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
            <button
              type="button"
              className="window-button"
              onClick={() => void windowHandle.minimize()}
              aria-label={messages.common.windowControls.minimize}
            >
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
              onClick={() => void windowHandle.close()}
              aria-label={messages.common.windowControls.close}
            >
              <X className="window-icon close-window-icon" strokeWidth={1.2} aria-hidden="true" />
            </button>
          </div>
          <div className="settings-window-loading">{messages.settings.loading}</div>
        </section>
      </div>
    );
  }

  return (
    <div className={`app theme-${effectiveTheme} settings-window-root ${isWindowMaximized ? "window-maximized" : ""}`}>
      <section className="settings-screen standalone">
        <div className="settings-drag-region" onPointerDown={handleWindowDragStart} />
        <div className="settings-window-controls">
          <button
            type="button"
            className="window-button"
            onClick={() => void windowHandle.minimize()}
            aria-label={messages.common.windowControls.minimize}
          >
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
            onClick={() => void windowHandle.close()}
            aria-label={messages.common.windowControls.close}
          >
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
              <button type="button" className={`settings-nav-item ${settingsNav === "language" ? "active" : ""}`} onClick={() => jumpToSettingsSection("language")}>{messages.settings.navigation.language}</button>
              <button type="button" className={`settings-nav-item ${settingsNav === "appearance" ? "active" : ""}`} onClick={() => jumpToSettingsSection("appearance")}>{messages.settings.navigation.appearance}</button>
              <button type="button" className={`settings-nav-item ${settingsNav === "formatting" ? "active" : ""}`} onClick={() => jumpToSettingsSection("formatting")}>{messages.settings.navigation.formatting}</button>
              <button type="button" className={`settings-nav-item ${settingsNav === "features" ? "active" : ""}`} onClick={() => jumpToSettingsSection("features")}>{messages.settings.navigation.features}</button>
              <button type="button" className={`settings-nav-item ${settingsNav === "startup" ? "active" : ""}`} onClick={() => jumpToSettingsSection("startup")}>{messages.settings.navigation.startup}</button>
              <button type="button" className={`settings-nav-item ${settingsNav === "about" ? "active" : ""}`} onClick={() => jumpToSettingsSection("about")}>{messages.settings.navigation.about}</button>
            </div>
          </aside>

          <div className="settings-content" ref={settingsContentRef}>
            <div className="settings-sections">
              <section id="settings-language" className="settings-block">
                <h2>{messages.settings.language.title}</h2>
                <p className="settings-desc">{messages.settings.language.description}</p>
                <div className="settings-card">
                  <div className="settings-field-row">
                    <div>
                      <strong>{messages.settings.language.label}</strong>
                      <small>{messages.settings.language.helper}</small>
                    </div>
                    <select
                      value={snapshot.languagePreference}
                      onChange={(event) =>
                        void sendPatch({
                          languagePreference: event.target.value as LanguagePreference,
                        })
                      }
                    >
                      <option value="system">{messages.common.languageOptions.system}</option>
                      <option value="ja">{messages.common.languageOptions.ja}</option>
                      <option value="en">{messages.common.languageOptions.en}</option>
                      <option value="es">{messages.common.languageOptions.es}</option>
                      <option value="pt-BR">{messages.common.languageOptions["pt-BR"]}</option>
                      <option value="ko">{messages.common.languageOptions.ko}</option>
                    </select>
                  </div>
                </div>
              </section>

              <section id="settings-appearance" className="settings-block">
                <h2>{messages.settings.appearance.title}</h2>
                <p className="settings-desc">{messages.settings.appearance.description}</p>
                <div className="theme-options">
                  <button type="button" className={`theme-card ${snapshot.themeMode === "light" ? "active" : ""}`} onClick={() => void sendPatch({ themeMode: "light" })}>
                    <span className="theme-icon"><Sun size={18} strokeWidth={1.8} aria-hidden="true" /></span>
                    <span>{messages.settings.appearance.themeLight}</span>
                  </button>
                  <button type="button" className={`theme-card ${snapshot.themeMode === "dark" ? "active" : ""}`} onClick={() => void sendPatch({ themeMode: "dark" })}>
                    <span className="theme-icon"><Moon size={18} strokeWidth={1.8} aria-hidden="true" /></span>
                    <span>{messages.settings.appearance.themeDark}</span>
                  </button>
                  <button type="button" className={`theme-card ${snapshot.themeMode === "system" ? "active" : ""}`} onClick={() => void sendPatch({ themeMode: "system" })}>
                    <span className="theme-icon"><Monitor size={18} strokeWidth={1.8} aria-hidden="true" /></span>
                    <span>{messages.settings.appearance.themeSystem}</span>
                  </button>
                </div>
              </section>

              <section id="settings-formatting" className="settings-block">
                <h2>{messages.settings.formatting.title}</h2>
                <p className="settings-desc">{messages.settings.formatting.description}</p>
                <div className="settings-card">
                  <div className="settings-field-row">
                    <div>
                      <strong>{messages.settings.formatting.fontSizeLabel}</strong>
                      <small>{messages.settings.formatting.fontSizeDescription}</small>
                    </div>
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
                    <div>
                      <strong>{messages.settings.formatting.lineSpacingLabel}</strong>
                      <small>{messages.settings.formatting.lineSpacingDescription}</small>
                    </div>
                    <select
                      value={snapshot.lineSpacing}
                      onChange={(event) => void sendPatch({ lineSpacing: event.target.value as LineSpacing })}
                    >
                      <option value="standard">{messages.settings.formatting.lineSpacingStandard}</option>
                      <option value="relaxed">{messages.settings.formatting.lineSpacingRelaxed}</option>
                    </select>
                  </div>
                  <div className="settings-field-row switch">
                    <div>
                      <strong>{messages.settings.formatting.wrapLabel}</strong>
                      <small>{messages.settings.formatting.wrapDescription}</small>
                    </div>
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
                    <p className="settings-preview-title">{messages.settings.formatting.previewTitle}</p>
                    <p className="settings-preview-line">{messages.settings.formatting.previewLine1}</p>
                    <p className="settings-preview-line">{messages.settings.formatting.previewLine2}</p>
                  </div>
                </div>
              </section>

              <section id="settings-features" className="settings-block">
                <h2>{messages.settings.features.title}</h2>
                <p className="settings-desc">{messages.settings.features.description}</p>
                <div className="feature-row">
                  <div>
                    <strong>{messages.settings.features.alwaysOnTopLabel}</strong>
                    <small>{messages.settings.features.alwaysOnTopDescription}</small>
                  </div>
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
                  <div>
                    <strong>{messages.settings.features.globalShortcutsLabel}</strong>
                    <small>{messages.settings.features.globalShortcutsDescription}</small>
                  </div>
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
                <h2>{messages.settings.startup.title}</h2>
                <p className="settings-desc">{messages.settings.startup.description}</p>
                <div className="startup-grid">
                  <div className="startup-card">
                    <strong>{messages.settings.startup.sessionLabel}</strong>
                    <label>
                      <input type="radio" name="session" checked={snapshot.sessionBehavior === "restore"} onChange={() => void sendPatch({ sessionBehavior: "restore" })} />
                      {messages.settings.startup.restoreSession}
                    </label>
                    <label>
                      <input type="radio" name="session" checked={snapshot.sessionBehavior === "new"} onChange={() => void sendPatch({ sessionBehavior: "new" })} />
                      {messages.settings.startup.startNewSession}
                    </label>
                  </div>
                  <div className="startup-card">
                    <strong>{messages.settings.startup.fileOpenLabel}</strong>
                    <label>
                      <input type="radio" name="open" checked={snapshot.fileOpenBehavior === "existing"} onChange={() => void sendPatch({ fileOpenBehavior: "existing" })} />
                      {messages.settings.startup.openInExistingWindow}
                    </label>
                    <label>
                      <input type="radio" name="open" checked={snapshot.fileOpenBehavior === "new_window"} onChange={() => void sendPatch({ fileOpenBehavior: "new_window" })} />
                      {messages.settings.startup.openInNewWindow}
                    </label>
                  </div>
                </div>
              </section>

              <section id="settings-about" className="settings-about-card">
                <div className="about-logo">🗒</div>
                <h3>AlwaysMemo</h3>
                <p>{messages.settings.about.description}</p>
                <div className="about-meta">
                  <span>{messages.settings.about.version("0.1")}</span>
                  <span>{messages.settings.about.settingsWindow}</span>
                  <span>{messages.settings.about.license}</span>
                </div>
                <div className="about-links" aria-label={messages.settings.about.linksLabel}>
                  <button
                    type="button"
                    className="about-link-button"
                    onClick={() => {
                      void openExternalPage(HELP_URL);
                    }}
                  >
                    <span>{messages.settings.about.help}</span>
                    <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="about-link-button"
                    onClick={() => {
                      void openExternalPage(TERMS_URL);
                    }}
                  >
                    <span>{messages.settings.about.terms}</span>
                    <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="about-link-button"
                    onClick={() => {
                      void openExternalPage(PRIVACY_URL);
                    }}
                  >
                    <span>{messages.settings.about.privacy}</span>
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
