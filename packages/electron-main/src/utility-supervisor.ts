import {
  ipcContractVersion,
  isUtilityStatusMessage,
} from "@erc-chart/contracts";

export type UtilitySupervisorStatus =
  "idle" | "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface UtilityChild {
  readonly postMessage: (message: unknown) => void;
  readonly kill: () => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
  readonly onExit: (listener: (code: number | null) => void) => () => void;
}

export interface UtilityScheduler {
  readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout: (timer: unknown) => void;
}

export interface UtilitySupervisorOptions {
  readonly spawn: (entryPath: string, args: readonly string[]) => UtilityChild;
  readonly scheduler: UtilityScheduler;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly onUnavailable: (code: "UTILITY_EXITED") => void;
}

export interface UtilitySupervisor {
  readonly start: (
    entryPath: string,
    args?: readonly string[],
    initialMessages?: readonly unknown[],
  ) => Promise<void>;
  readonly postMessage: (message: unknown) => void;
  readonly onMessage: (listener: (message: unknown) => void) => () => void;
  readonly shutdown: () => Promise<void>;
  readonly getStatus: () => UtilitySupervisorStatus;
}

export function createUtilitySupervisor(
  options: UtilitySupervisorOptions,
): UtilitySupervisor {
  let status: UtilitySupervisorStatus = "idle";
  let child: UtilityChild | undefined;
  let timer: unknown;
  let removeMessage = (): void => undefined;
  let removeExit = (): void => undefined;
  let resolveStart: (() => void) | undefined;
  let rejectStart: ((error: Error) => void) | undefined;
  let resolveShutdown: (() => void) | undefined;
  let shutdownPromise: Promise<void> | undefined;
  const externalMessageListeners = new Set<(message: unknown) => void>();

  const clearTimer = (): void => {
    if (timer === undefined) return;
    options.scheduler.clearTimeout(timer);
    timer = undefined;
  };

  const removeListeners = (): void => {
    const removeCurrentMessage = removeMessage;
    const removeCurrentExit = removeExit;
    removeMessage = (): void => undefined;
    removeExit = (): void => undefined;
    try {
      removeCurrentMessage();
    } catch {
      // Listener cleanup cannot leave the supervisor in a transitional state.
    }
    try {
      removeCurrentExit();
    } catch {
      // Listener cleanup cannot leave the supervisor in a transitional state.
    }
  };

  const failStart = (error: Error, terminate: boolean): void => {
    if (status !== "starting") return;
    clearTimer();
    removeListeners();
    status = "failed";
    if (terminate) {
      try {
        child?.kill();
      } catch {
        // Startup failure still rejects even if termination reports failure.
      }
    }
    child = undefined;
    rejectStart?.(error);
    resolveStart = undefined;
    rejectStart = undefined;
  };

  const finishStopped = (): void => {
    clearTimer();
    removeListeners();
    status = "stopped";
    child = undefined;
    resolveShutdown?.();
    resolveShutdown = undefined;
    shutdownPromise = undefined;
  };

  const onMessage = (message: unknown): void => {
    for (const listener of [...externalMessageListeners]) {
      try {
        listener(message);
      } catch {
        // One observer cannot block lifecycle processing or other observers.
      }
    }
    if (!isUtilityStatusMessage(message)) return;
    if (message.type === "ready" && status === "starting") {
      clearTimer();
      status = "ready";
      resolveStart?.();
      resolveStart = undefined;
      rejectStart = undefined;
    } else if (message.type === "error" && status === "starting") {
      failStart(new Error("Utility reported a startup error."), true);
    } else if (message.type === "stopped" && status === "stopping") {
      finishStopped();
    }
  };

  const onExit = (): void => {
    if (status === "starting") {
      failStart(new Error("Utility exited before ready."), false);
    } else if (status === "ready") {
      clearTimer();
      removeListeners();
      status = "failed";
      child = undefined;
      options.onUnavailable("UTILITY_EXITED");
    } else if (status === "stopping") {
      finishStopped();
    }
  };

  const start = (
    entryPath: string,
    args: readonly string[] = [],
    initialMessages: readonly unknown[] = [],
  ): Promise<void> => {
    if (status !== "idle" && status !== "stopped" && status !== "failed") {
      return Promise.reject(new Error("Utility has already been started."));
    }
    clearTimer();
    removeListeners();
    shutdownPromise = undefined;
    resolveShutdown = undefined;
    status = "starting";

    const started = new Promise<void>((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    try {
      child = options.spawn(entryPath, args);
      removeMessage = child.onMessage(onMessage);
      removeExit = child.onExit(onExit);
      for (const message of initialMessages) child.postMessage(message);
    } catch {
      try {
        removeListeners();
      } catch {
        removeMessage = (): void => undefined;
        removeExit = (): void => undefined;
      }
      try {
        child?.kill();
      } catch {
        // The supervisor still resets its own state if child cleanup fails.
      }
      child = undefined;
      status = "failed";
      rejectStart?.(new Error("Utility process could not start."));
      resolveStart = undefined;
      rejectStart = undefined;
      return started;
    }

    timer = options.scheduler.setTimeout(() => {
      failStart(new Error("Utility failed to become ready."), true);
    }, options.startupTimeoutMs);
    return started;
  };

  const postMessage = (message: unknown): void => {
    if ((status !== "starting" && status !== "ready") || child === undefined)
      throw new Error("Utility is unavailable.");
    child.postMessage(message);
  };

  const shutdown = (): Promise<void> => {
    if (status === "idle" || status === "stopped") return Promise.resolve();
    if (status === "stopping") return shutdownPromise ?? Promise.resolve();
    if (status === "starting") {
      failStart(new Error("Utility stopped during startup."), true);
      status = "stopped";
      return Promise.resolve();
    }
    if (status === "failed") {
      status = "stopped";
      return Promise.resolve();
    }

    status = "stopping";
    shutdownPromise = new Promise<void>((resolve) => {
      resolveShutdown = resolve;
    });
    try {
      child?.postMessage({
        type: "shutdown",
        contractVersion: ipcContractVersion,
      });
    } catch {
      try {
        child?.kill();
      } catch {
        // The supervisor still completes if process termination reports failure.
      }
      finishStopped();
      return shutdownPromise ?? Promise.resolve();
    }
    timer = options.scheduler.setTimeout(() => {
      try {
        child?.kill();
      } catch {
        // The supervisor still completes if forced termination reports failure.
      }
      finishStopped();
    }, options.shutdownTimeoutMs);
    return shutdownPromise;
  };

  return {
    start,
    postMessage,
    onMessage: (listener): (() => void) => {
      externalMessageListeners.add(listener);
      return (): void => {
        externalMessageListeners.delete(listener);
      };
    },
    shutdown,
    getStatus: (): UtilitySupervisorStatus => status,
  };
}
