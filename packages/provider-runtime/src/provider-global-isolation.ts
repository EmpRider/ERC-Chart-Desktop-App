const blockedProviderGlobals = [
  "process",
  "fetch",
  "WebSocket",
  "EventSource",
  "localStorage",
  "sessionStorage",
  "require",
  "module",
] as const;

export function restrictProviderRuntimeGlobals(
  target: typeof globalThis = globalThis,
): void {
  const globals = target as unknown as Record<string, unknown>;
  for (const key of blockedProviderGlobals) {
    Object.defineProperty(globals, key, {
      value: undefined,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
}
