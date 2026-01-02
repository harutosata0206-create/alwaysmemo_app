import { useCallback, useEffect, useMemo, useState } from "react";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import {
  currentMonitor,
  getCurrentWindow,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import "./App.css";

const SHORTCUT_LABEL = "Ctrl + Alt +";

function App() {
  const [useGlobalShortcuts, setUseGlobalShortcuts] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const toggleAlwaysOnTop = useCallback(async () => {
    const window = getCurrentWindow();
    try {
      const current = await window.isAlwaysOnTop();
      const next = !current;
      await window.setAlwaysOnTop(next);
      setAlwaysOnTop(next);
      setStatus(next ? "Always on top enabled" : "Always on top disabled");
    } catch (error) {
      console.error(error);
      setStatus("Failed to toggle always on top");
    }
  }, []);

  const snapLeft = useCallback(async () => {
    const window = getCurrentWindow();
    try {
      const monitor = await currentMonitor();
      if (!monitor) {
        setStatus("No monitor information available");
        return;
      }
      await window.setPosition(
        new PhysicalPosition(monitor.position.x, monitor.position.y),
      );
      setStatus("Snapped to top-left");
    } catch (error) {
      console.error(error);
      setStatus("Failed to snap left");
    }
  }, []);

  const snapRight = useCallback(async () => {
    const window = getCurrentWindow();
    try {
      const monitor = await currentMonitor();
      if (!monitor) {
        setStatus("No monitor information available");
        return;
      }
      const windowSize = await window.outerSize();
      const offset = Math.max(monitor.size.width - windowSize.width, 0);
      const x = monitor.position.x + offset;
      await window.setPosition(new PhysicalPosition(x, monitor.position.y));
      setStatus("Snapped to top-right");
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
        const current = await getCurrentWindow().isAlwaysOnTop();
        setAlwaysOnTop(current);
      } catch (error) {
        console.error(error);
        setStatus("Failed to read always on top state");
      }
    };
    void initState();
  }, []);

  useEffect(() => {
    const attachLocalListeners = () => {
      const handler = (event: KeyboardEvent) => {
        if (!event.ctrlKey || !event.altKey) return;
        switch (event.code) {
          case "KeyT": {
            event.preventDefault();
            void toggleAlwaysOnTop();
            break;
          }
          case "ArrowLeft": {
            event.preventDefault();
            void snapLeft();
            break;
          }
          case "ArrowRight": {
            event.preventDefault();
            void snapRight();
            break;
          }
          default:
            break;
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    };

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
          throw error;
        }
      }
      setStatus("Global shortcuts active");
    };

    let cleanupLocal: (() => void) | undefined;
    const setup = async () => {
      try {
        if (useGlobalShortcuts) {
          cleanupLocal?.();
          await registerGlobalShortcuts();
        } else {
          await unregisterAll();
          cleanupLocal = attachLocalListeners();
          setStatus("Local shortcuts active (window focused)");
        }
      } catch (error) {
        console.error(error);
        setStatus("Failed to configure shortcuts");
      }
    };

    void setup();

    return () => {
      void unregisterAll().catch((error) => {
        console.error("Failed to unregister shortcuts", error);
      });
      cleanupLocal?.();
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
