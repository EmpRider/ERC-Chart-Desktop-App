import { isIndicatorRuntimeSnapshot } from "@erc-chart/contracts";
import type {
  Candle,
  IndicatorParameterValues,
  IndicatorRuntimeOverlay,
  IndicatorRuntimePoint,
  IndicatorRuntimeSignal,
  IndicatorRuntimeSnapshot,
} from "@erc-chart/contracts";

export interface IndicatorWorkerExecutionRequest {
  readonly instanceId: string;
  readonly runtimeEntryUrl: string;
  readonly pluginId: string;
  readonly definitionId: string;
  readonly instrumentId: string;
  readonly timeframeId: string;
  readonly parameters: IndicatorParameterValues;
  readonly data: IndicatorWorkerDataUpdate;
  readonly dataRevision: number;
  readonly configGeneration: number;
}

export type IndicatorWorkerDataUpdate =
  | {
      readonly kind: "snapshot" | "rebuild";
      readonly candles: readonly Candle[];
    }
  | {
      readonly kind: "building";
      readonly candle: Candle;
    }
  | {
      readonly kind: "rollover";
      readonly finalized: Candle;
      readonly building: Candle;
    };

export interface IndicatorWorkerExecutionResult {
  readonly instanceId: string;
  readonly sequence: number;
  readonly dataRevision: number;
  readonly configGeneration: number;
  readonly result: IndicatorWorkerResultUpdate;
}

export type IndicatorWorkerResultUpdate =
  | {
      readonly kind: "snapshot";
      readonly snapshot: IndicatorRuntimeSnapshot;
    }
  | {
      readonly kind: "building" | "rollover";
      readonly points: readonly IndicatorRuntimePoint[];
      readonly overlays?: readonly IndicatorRuntimeOverlay[];
      readonly signals?: readonly IndicatorRuntimeSignal[];
    };

export interface IndicatorWorkerSyncMessage extends IndicatorWorkerExecutionRequest {
  readonly type: "sync";
  readonly sequence: number;
}

export interface IndicatorWorkerDisposeMessage {
  readonly type: "dispose";
  readonly instanceId: string;
}

export type IndicatorWorkerRequestMessage =
  IndicatorWorkerSyncMessage | IndicatorWorkerDisposeMessage;

export interface IndicatorWorkerSuccessMessage extends IndicatorWorkerExecutionResult {
  readonly type: "result";
}

export interface IndicatorWorkerFailureMessage {
  readonly type: "error";
  readonly instanceId: string;
  readonly sequence: number;
  readonly dataRevision: number;
  readonly configGeneration: number;
  readonly code: string;
  readonly message: string;
}

export type IndicatorWorkerResponseMessage =
  IndicatorWorkerSuccessMessage | IndicatorWorkerFailureMessage;

export interface IndicatorWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => unknown) | null;
  onerror: ((event: ErrorEvent) => unknown) | null;
  postMessage(message: IndicatorWorkerRequestMessage): void;
  terminate(): void;
}

export type IndicatorWorkerFactory = (
  instanceId: string,
) => IndicatorWorkerLike;

export interface IndicatorWorkerSupervisorOptions {
  readonly workerFactory?: IndicatorWorkerFactory;
  readonly startupTimeoutMs?: number;
  readonly updateTimeoutMs?: number;
}

export interface IndicatorWorkerSupervisor {
  readonly sync: (
    request: IndicatorWorkerExecutionRequest,
  ) => Promise<IndicatorWorkerExecutionResult>;
  readonly disposeInstance: (instanceId: string) => void;
  readonly dispose: () => void;
}

export class IndicatorWorkerRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "IndicatorWorkerRuntimeError";
    this.code = code;
  }
}

interface PendingRequest {
  readonly request: IndicatorWorkerSyncMessage;
  readonly resolve: (result: IndicatorWorkerExecutionResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface WorkerState {
  readonly worker: IndicatorWorkerLike;
  readonly pending: Map<number, PendingRequest>;
  readonly staleWaiters: PendingRequest[];
  latestSequence: number;
  latestResult?: IndicatorWorkerExecutionResult;
  initialized: boolean;
}

const defaultStartupTimeoutMs = 2_000;
const defaultUpdateTimeoutMs = 100;

function positiveTimeout(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function defaultWorkerFactory(instanceId: string): IndicatorWorkerLike {
  return new Worker("erc-app://app/indicator-worker.js", {
    type: "module",
    name: `erc-indicator:${instanceId}`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeGeneration(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isWorkerResultUpdate(
  value: unknown,
): value is IndicatorWorkerResultUpdate {
  if (!isRecord(value)) return false;
  if (value.kind === "snapshot")
    return isIndicatorRuntimeSnapshot(value.snapshot);
  if (value.kind !== "building" && value.kind !== "rollover") return false;
  const expectedPointCount = value.kind === "building" ? 1 : 2;
  return (
    Array.isArray(value.points) &&
    value.points.length === expectedPointCount &&
    (value.overlays === undefined || Array.isArray(value.overlays)) &&
    (value.signals === undefined || Array.isArray(value.signals)) &&
    isIndicatorRuntimeSnapshot({
      points: value.points,
      overlays: value.overlays ?? [],
      signals: value.signals ?? [],
    })
  );
}

function isWorkerResponse(
  value: unknown,
): value is IndicatorWorkerResponseMessage {
  if (
    !isRecord(value) ||
    (value.type !== "result" && value.type !== "error") ||
    typeof value.instanceId !== "string" ||
    !Number.isSafeInteger(value.sequence) ||
    Number(value.sequence) < 1 ||
    !isSafeGeneration(value.dataRevision) ||
    !isSafeGeneration(value.configGeneration)
  ) {
    return false;
  }
  if (value.type === "error") {
    return typeof value.code === "string" && typeof value.message === "string";
  }
  return isWorkerResultUpdate(value.result);
}

export function createIndicatorWorkerSupervisor(
  options: IndicatorWorkerSupervisorOptions = {},
): IndicatorWorkerSupervisor {
  const workerFactory = options.workerFactory ?? defaultWorkerFactory;
  const startupTimeoutMs = positiveTimeout(
    options.startupTimeoutMs,
    defaultStartupTimeoutMs,
  );
  const updateTimeoutMs = positiveTimeout(
    options.updateTimeoutMs,
    defaultUpdateTimeoutMs,
  );
  const states = new Map<string, WorkerState>();
  let nextSequence = 1;

  const settleStale = (state: WorkerState, pending: PendingRequest): void => {
    if (state.latestResult?.sequence === state.latestSequence) {
      pending.resolve(state.latestResult);
      return;
    }
    state.staleWaiters.push(pending);
  };

  const failState = (instanceId: string, error: Error): void => {
    const state = states.get(instanceId);
    if (state === undefined) return;
    states.delete(instanceId);
    state.worker.terminate();
    for (const pending of state.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    state.pending.clear();
    for (const pending of state.staleWaiters.splice(0)) pending.reject(error);
  };

  const createState = (instanceId: string): WorkerState => {
    const worker = workerFactory(instanceId);
    const state: WorkerState = {
      worker,
      pending: new Map(),
      staleWaiters: [],
      latestSequence: 0,
      initialized: false,
    };
    worker.onerror = (event): void => {
      failState(
        instanceId,
        new IndicatorWorkerRuntimeError(
          "INDICATOR_WORKER_CRASHED",
          event.message ?? "Indicator worker crashed.",
        ),
      );
    };
    worker.onmessage = (event): void => {
      if (!isWorkerResponse(event.data)) {
        failState(
          instanceId,
          new IndicatorWorkerRuntimeError(
            "INDICATOR_WORKER_PROTOCOL_INVALID",
            "Indicator worker returned an invalid message.",
          ),
        );
        return;
      }
      const message = event.data;
      const pending = state.pending.get(message.sequence);
      if (pending === undefined) return;
      if (
        message.instanceId !== pending.request.instanceId ||
        message.dataRevision !== pending.request.dataRevision ||
        message.configGeneration !== pending.request.configGeneration
      ) {
        failState(
          instanceId,
          new IndicatorWorkerRuntimeError(
            "INDICATOR_WORKER_PROTOCOL_INVALID",
            "Indicator worker response did not match its request generation.",
          ),
        );
        return;
      }
      clearTimeout(pending.timer);
      state.pending.delete(message.sequence);
      if (message.type === "error") {
        failState(
          instanceId,
          new IndicatorWorkerRuntimeError(message.code, message.message),
        );
        return;
      }
      if (message.sequence < state.latestSequence) {
        settleStale(state, pending);
        return;
      }
      state.initialized = true;
      state.latestResult = message;
      pending.resolve(message);
      for (const stale of state.staleWaiters.splice(0)) {
        clearTimeout(stale.timer);
        stale.resolve(message);
      }
    };
    states.set(instanceId, state);
    return state;
  };

  const sync = (
    request: IndicatorWorkerExecutionRequest,
  ): Promise<IndicatorWorkerExecutionResult> => {
    const existingState = states.get(request.instanceId);
    if (
      existingState === undefined &&
      request.data.kind !== "snapshot" &&
      request.data.kind !== "rebuild"
    ) {
      return Promise.reject(
        new IndicatorWorkerRuntimeError(
          "INDICATOR_WORKER_SNAPSHOT_REQUIRED",
          "Indicator worker requires a history snapshot before incremental updates.",
        ),
      );
    }
    const state = existingState ?? createState(request.instanceId);
    const sequence = nextSequence;
    nextSequence += 1;
    state.latestSequence = sequence;
    const message: IndicatorWorkerSyncMessage = {
      type: "sync",
      sequence,
      ...request,
    };
    return new Promise<IndicatorWorkerExecutionResult>((resolve, reject) => {
      const timeoutMs = state.initialized ? updateTimeoutMs : startupTimeoutMs;
      const timer = setTimeout(() => {
        const pending = state.pending.get(sequence);
        if (pending === undefined) return;
        if (sequence < state.latestSequence) {
          state.pending.delete(sequence);
          settleStale(state, pending);
          return;
        }
        failState(
          request.instanceId,
          new IndicatorWorkerRuntimeError(
            "INDICATOR_WORKER_TIMEOUT",
            "Indicator worker exceeded its execution budget.",
          ),
        );
      }, timeoutMs);
      state.pending.set(sequence, { request: message, resolve, reject, timer });
      state.worker.postMessage(message);
    });
  };

  return {
    sync,
    disposeInstance: (instanceId: string): void => {
      const state = states.get(instanceId);
      if (state === undefined) return;
      try {
        state.worker.postMessage({ type: "dispose", instanceId });
      } finally {
        failState(
          instanceId,
          new IndicatorWorkerRuntimeError(
            "INDICATOR_WORKER_DISPOSED",
            "Indicator worker was disposed.",
          ),
        );
      }
    },
    dispose: (): void => {
      for (const instanceId of [...states.keys()]) {
        failState(
          instanceId,
          new IndicatorWorkerRuntimeError(
            "INDICATOR_WORKER_DISPOSED",
            "Indicator worker was disposed.",
          ),
        );
      }
    },
  };
}
