import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import {
  RuntimeApplicationShell,
  type RendererBridge,
} from "./development-shell.js";

declare global {
  interface Window {
    readonly ercChart?: RendererBridge;
  }
}

export function mountRuntimeShell(
  root: HTMLElement,
  bridge: RendererBridge | undefined,
): Root {
  const reactRoot = createRoot(root);
  reactRoot.render(createElement(RuntimeApplicationShell, { bridge }));
  return reactRoot;
}

const root = document.getElementById("app");
if (root === null) throw new Error("Renderer root unavailable.");
export const runtimeRoot: Root = mountRuntimeShell(root, window.ercChart);
