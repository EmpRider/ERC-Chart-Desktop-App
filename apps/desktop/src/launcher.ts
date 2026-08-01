export function launchDesktopMain(
  start: () => Promise<void>,
  onFailure: (error: unknown) => void,
): void {
  void start().catch(onFailure);
}
