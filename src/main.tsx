import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./command-theme.css";
import { THEME_STYLE } from "./theme";

const root = document.getElementById("root");
if (!root) throw new Error("Application root element is missing.");

for (const [name, color] of Object.entries(THEME_STYLE)) {
  document.documentElement.style.setProperty(name, String(color));
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
