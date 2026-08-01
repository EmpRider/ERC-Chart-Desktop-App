import {
  renderDevelopmentShell,
  type RendererBridge,
} from "./development-shell.js";

declare global {
  interface Window {
    readonly ercChart?: RendererBridge;
  }
}

void renderDevelopmentShell(document, window.ercChart);
