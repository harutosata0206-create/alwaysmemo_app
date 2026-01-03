import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import "./App.css";

const SHORTCUT_LABEL = "Ctrl + Alt +";

function App() {
  const [useGlobalShortcuts, setUseGlobalShortcuts] = useState(true);
  const [alwaysOnTop, setAlwaysOnTopState] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

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
      setStatus("Snapped to top-left (hotkey)");
    } catch (error) {
      console.error(error);
      setStatus("Failed to snap left");
    }
  }, []);

  const snapRight = useCallback(async () => {
    try {
      await invoke("snap_right");
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
      } catch (error) {
        console.error(error);
        setStatus("Failed to read always on top state");
      }
    };
    void initState();
  }, []);

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

  return (
    <div className="app">
      <header>
        <div className="title">AlwaysMemo — Shortcuts</div>
        <div className="status">
          Always on top: <span className={alwaysOnTop ? "on" : "off"}>{alwaysOnTop ? "ON" : "OFF"}</span>
        </div>
      </header>

      <section className="card">
        <label className="toggle">
          <input
            type="checkbox"
            checked={useGlobalShortcuts}
            onChange={(event) => setUseGlobalShortcuts(event.target.checked)}
          />
          <span>Use global shortcuts (works without focus)</span>
        </label>
        <p className="hint">
          Toggle off to limit `Ctrl + Alt + T / Left / Right` to when this window is focused.
        </p>
        <div className="actions">
          <button type="button" onClick={() => void setAlwaysOnTop(true)}>
            Force ON
          </button>
          <button type="button" onClick={() => void setAlwaysOnTop(false)}>
            Force OFF
          </button>
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
      </section>

      {status ? <div className="status-bar">{status}</div> : null}
    </div>
  );
}

export default App;
