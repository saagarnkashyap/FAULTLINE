import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { THEME_STYLE } from "./theme";

for (const [name, value] of Object.entries(THEME_STYLE)) document.documentElement.style.setProperty(name, String(value));

const root = document.getElementById("root");
if (!root) throw new Error("Application root element is missing.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
