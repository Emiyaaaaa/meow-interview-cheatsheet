import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isOverlayWindow } from "./overlayWindow";
import "./styles.css";

if (isOverlayWindow()) {
  document.documentElement.classList.add("overlay-window");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
