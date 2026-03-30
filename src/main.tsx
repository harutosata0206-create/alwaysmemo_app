import { invoke } from "@tauri-apps/api/core";
import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsWindow from "./SettingsWindow";

const params = new URLSearchParams(window.location.search);
const isSettingsWindow = params.get("view") === "settings";

void invoke("write_debug_log", {
  message: `main.tsx loaded view=${isSettingsWindow ? "settings" : "app"}`,
}).catch(() => {
  // Ignore logging failures during boot.
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  isSettingsWindow ? <SettingsWindow /> : <App />,
);
