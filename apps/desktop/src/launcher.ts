export function launchDesktopMain(
  start: () => Promise<void>,
  onFailure: (error: unknown) => void,
): void {
  void start().catch(onFailure);
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
