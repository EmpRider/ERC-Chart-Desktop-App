import { contextBridge, ipcRenderer } from "electron";
import { installBridge } from "./bridge.js";

installBridge(
  (key, api): void => contextBridge.exposeInMainWorld(key, api),
  async (channel, ...args): Promise<unknown> =>
    ipcRenderer.invoke(channel, ...args),
  (channel, listener): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: unknown,
    ): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, handler);
    return (): void => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
);
