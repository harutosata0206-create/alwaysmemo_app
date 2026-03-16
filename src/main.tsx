import ReactDOM from "react-dom/client";
import App from "./App";
import SettingsWindow from "./SettingsWindow";

const params = new URLSearchParams(window.location.search);
const isSettingsWindow = params.get("view") === "settings";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  isSettingsWindow ? <SettingsWindow /> : <App />,
);
