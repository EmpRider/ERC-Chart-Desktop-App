import { createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  RuntimeApplicationShell,
  type RendererBridge,
} from "./development-shell.js";

declare global {
  interface Window {
    readonly ercChart?: RendererBridge;
  }
}

const root = document.getElementById("app");
if (root === null) throw new Error("Renderer root unavailable.");
createRoot(root).render(
  createElement(RuntimeApplicationShell, { bridge: window.ercChart }),
);
