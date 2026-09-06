import path from "node:path";
import electronPath from "electron";

import { runElectronProcess } from "./electron-smoke-process.mjs";

const root = path.resolve(import.meta.dirname, "..");
const entryPath = path.join(
  root,
  "tools",
  "electron-indicator-worker-smoke-entry.mjs",
);

await runElectronProcess({
  executable: electronPath,
  args: [entryPath],
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
  },
  timeoutMs: 15_000,
  readyMarker: "ERC_CHART_INDICATOR_WORKER_SMOKE_READY",
});
