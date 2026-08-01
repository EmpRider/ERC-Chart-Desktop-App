import {
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
    registerSchemes([rendererSchemeRegistration]);
  } catch (error) {
    onFailure(error);
    return;
  }
  launchDesktopMain(start, onFailure);
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
