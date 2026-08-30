import { contextBridge, ipcRenderer } from "electron";
import { installBridge } from "./bridge.js";

installBridge(
  (key, api): void => contextBridge.exposeInMainWorld(key, api),
  async (channel, ...args): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),
);
