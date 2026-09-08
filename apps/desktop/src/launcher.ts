import {
  indicatorPluginSchemeRegistration,
  rendererSchemeRegistration,
  type RendererSchemeRegistration,
} from "@erc-chart/electron-main";

export function launchDesktopMain(
  start: () => Promise<void>,
  onFailure: (error: unknown) => void,
): void {
  void start().catch(onFailure);
}

export function launchDesktopMainWithProtocol(
  registerSchemes: (schemes: RendererSchemeRegistration[]) => void,
  start: () => Promise<void>,
  onFailure: (error: unknown) => void,
): void {
  try {
    registerSchemes([
      rendererSchemeRegistration,
      indicatorPluginSchemeRegistration,
    ]);
  } catch (error) {
    onFailure(error);
    return;
  }
  launchDesktopMain(start, onFailure);
}

export async function flushWorkspaceBeforeQuit(
  flush: () => Promise<void>,
  choose: () => Promise<"retry" | "cancel">,
): Promise<boolean> {
  for (;;) {
    try {
      await flush();
      return true;
    } catch {
      if ((await choose()) === "cancel") return false;
    }
  }
}

interface DesktopSmokeController {
  readonly shutdown: () => Promise<void>;
}

export async function finishDesktopSmoke(
  controller: Promise<DesktopSmokeController>,
  exitCode: number,
  exit: (exitCode: number) => void,
): Promise<void> {
  try {
    await (await controller).shutdown();
  } finally {
    exit(exitCode);
  }
}
