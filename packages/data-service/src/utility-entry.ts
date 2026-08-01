import { createUtilityRuntime, type UtilityPort } from "./utility-runtime.js";
import nodeProcess from "node:process";
import type { ParentPort } from "electron";

const parentPort = (
  nodeProcess as typeof nodeProcess & {
    readonly parentPort?: ParentPort;
  }
).parentPort;
if (parentPort === undefined || parentPort === null) {
  throw new Error("Utility parent port unavailable.");
}

const port: UtilityPort = {
  postMessage: (message): void => parentPort.postMessage(message),
  onMessage: (listener): (() => void) => {
    const receive = (event: Electron.MessageEvent): void =>
      listener(event.data);
    parentPort.on("message", receive);
    return (): void => {
      parentPort.off("message", receive);
    };
  },
};

createUtilityRuntime(port);
