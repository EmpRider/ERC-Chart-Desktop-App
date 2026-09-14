import {
  isIndicatorRuntimeSnapshot,
  isIndicatorWorkerCandleSnapshot,
} from "@erc-chart/contracts";
import type {
  Candle,
  IndicatorParameterValue,
  IndicatorParameterValues,
  IndicatorRuntimeOverlay,
  IndicatorRuntimePoint,
  IndicatorRuntimeSignal,
  IndicatorRuntimeSnapshot,
  IndicatorWorkerCandleSnapshot,
  InstalledIndicatorDefinition,
  InstalledIndicatorInputDefinition,
} from "@erc-chart/contracts";
import type { IndicatorSourceProvenance } from "./source-engine.js";

function stepDecimals(step: number): number {
  const text = `${step}`.toLowerCase();
  if (text.includes("e-")) {
    const [coefficient = "", exponent = "0"] = text.split("e-");
    const fraction = coefficient.split(".")[1]?.length ?? 0;
    return Math.min(20, fraction + Number(exponent));
  }
  return Math.min(20, text.split(".")[1]?.length ?? 0);
}

function normalizeIndicatorInputValue(
  definition: InstalledIndicatorInputDefinition,
  value: unknown,
): IndicatorParameterValue {
  if (definition.type === "boolean")
    return typeof value === "boolean" ? value : definition.defaultValue;
  if (definition.type === "number") {
    const raw =
      typeof value === "number" && Number.isFinite(value)
        ? value
        : definition.defaultValue;
    const bounded = Math.min(
      definition.max ?? raw,
      Math.max(definition.min ?? raw, raw),
    );
    if (definition.step === undefined) return bounded;
    return Number(bounded.toFixed(stepDecimals(definition.step)));
  }
  if (typeof value !== "string" || value.length > 8_192)
    return definition.defaultValue;
  if (
    definition.options !== undefined &&
    !definition.options.some((option) => option.value === value)
  )
    return definition.defaultValue;
  return value;
}

export function normalizeIndicatorParameters(
  definition: InstalledIndicatorDefinition,
  supplied: Readonly<Record<string, unknown>>,
): IndicatorParameterValues {
  return Object.freeze(
    Object.fromEntries(
      definition.inputs.map((input) => [
        input.key,
        normalizeIndicatorInputValue(input, supplied[input.key]),
      ]),
    ),
  );
}

export interface IndicatorWorkerExecutionRequest {
  readonly instanceId: string;
  readonly runtimeEntryUrl: string;
  readonly pluginId: string;
  readonly definitionId: string;
  readonly instrumentId: string;
  readonly timeframeId: string;
  readonly parameters: IndicatorParameterValues;
  readonly sourceProvenance?: IndicatorSourceProvenance;
  readonly sources?: readonly IndicatorWorkerSourceSnapshot[];
  readonly data: IndicatorWorkerDataUpdate;
  readonly dataRevision: number;
  readonly configGeneration: number;
}

export interface IndicatorWorkerSourceSnapshot {
  readonly providerProfileId: string;
  readonly instrumentId: string;
  readonly timeframeId: string;
  readonly activeTimeframeId?: string;
  readonly snapshot: IndicatorWorkerCandleSnapshot;
  readonly provenance: IndicatorSourceProvenance;
  readonly generation: number;
  readonly revision: number;
  readonly finalizedCount: number;
}

export type IndicatorWorkerDataUpdate =
  | {
      readonly kind: "snapshot";
      readonly snapshot: IndicatorWorkerCandleSnapshot;
    }
  | {
      readonly kind: "rebuild";
      readonly snapshot: IndicatorWorkerCandleSnapshot;
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
const maximumHistoryTimeoutMs = 60_000;
const historyTimeoutPerBarMs = 5;

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

function isNonEmptyText(value: unknown, maximum = 256): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value
  );
}

function isCandle(value: unknown): value is Candle {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyText(value.instrumentId) &&
    isNonEmptyText(value.timeframeId, 64) &&
    Number.isSafeInteger(value.openTimeMs) &&
    Number(value.openTimeMs) >= 0 &&
    Number.isFinite(value.open) &&
    Number.isFinite(value.high) &&
    Number.isFinite(value.low) &&
    Number.isFinite(value.close) &&
    (value.volume === undefined || Number.isFinite(value.volume))
  );
}

function isSourceProvenance(
  value: unknown,
): value is IndicatorSourceProvenance {
  if (!isRecord(value)) return false;
  return (
    (value.kind === "market" && value.candleType === "standard") ||
    (value.kind === "synthetic" && value.candleType === "heikin-ashi")
  );
}

function isParameterValues(value: unknown): value is IndicatorParameterValues {
  if (!isRecord(value) || Object.keys(value).length > 128) return false;
  return Object.values(value).every(
    (item) =>
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item)) ||
      (typeof item === "string" && item.length <= 8_192),
  );
}

function isWorkerSourceSnapshot(
  value: unknown,
): value is IndicatorWorkerSourceSnapshot {
  if (!isRecord(value)) return false;
  const activeTimeframeId = value.activeTimeframeId ?? value.timeframeId;
  return (
    isNonEmptyText(value.providerProfileId) &&
    isNonEmptyText(value.instrumentId) &&
    isNonEmptyText(value.timeframeId, 64) &&
    isNonEmptyText(activeTimeframeId, 64) &&
    isIndicatorWorkerCandleSnapshot(value.snapshot) &&
    isSourceProvenance(value.provenance) &&
    isSafeGeneration(value.generation) &&
    isSafeGeneration(value.revision) &&
    Number.isSafeInteger(value.finalizedCount) &&
    Number(value.finalizedCount) >= 0 &&
    Number(value.finalizedCount) <= value.snapshot.openTimeMs.length
  );
}

function isWorkerDataUpdate(
  value: unknown,
): value is IndicatorWorkerDataUpdate {
  if (!isRecord(value)) return false;
  if (value.kind === "snapshot" || value.kind === "rebuild") {
    return isIndicatorWorkerCandleSnapshot(value.snapshot);
  }
  if (value.kind === "building") return isCandle(value.candle);
  return (
    value.kind === "rollover" &&
    isCandle(value.finalized) &&
    isCandle(value.building)
  );
}

function isWorkerExecutionRequest(
  value: unknown,
): value is IndicatorWorkerExecutionRequest {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyText(value.instanceId) &&
    isNonEmptyText(value.runtimeEntryUrl, 2_048) &&
    isNonEmptyText(value.pluginId) &&
    isNonEmptyText(value.definitionId) &&
    isNonEmptyText(value.instrumentId) &&
    isNonEmptyText(value.timeframeId, 64) &&
    isParameterValues(value.parameters) &&
    (value.sourceProvenance === undefined ||
      isSourceProvenance(value.sourceProvenance)) &&
    (value.sources === undefined ||
      (Array.isArray(value.sources) &&
        value.sources.length <= 64 &&
        value.sources.every(isWorkerSourceSnapshot))) &&
    isWorkerDataUpdate(value.data) &&
    isSafeGeneration(value.dataRevision) &&
    isSafeGeneration(value.configGeneration)
  );
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
    if (!isWorkerExecutionRequest(request)) {
      return Promise.reject(
        new IndicatorWorkerRuntimeError(
          "INDICATOR_WORKER_PROTOCOL_INVALID",
          "Indicator worker request failed protocol validation.",
        ),
      );
    }
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
      const historyCalculation =
        request.data.kind === "snapshot" || request.data.kind === "rebuild";
      const historyTimeoutMs = historyCalculation
        ? Math.min(
            maximumHistoryTimeoutMs,
            startupTimeoutMs +
              (isIndicatorWorkerCandleSnapshot(request.data.snapshot)
                ? request.data.snapshot.openTimeMs.length
                : 0) *
                historyTimeoutPerBarMs,
          )
        : startupTimeoutMs;
      const timeoutMs =
        !state.initialized || historyCalculation
          ? historyTimeoutMs
          : updateTimeoutMs;
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

export { createIndicatorSourceEngine } from "./source-engine.js";
export type {
  IndicatorCandleType,
  IndicatorSourceProvenance,
  IndicatorSourceDataService,
  IndicatorSourceEngine,
  IndicatorSourceHistoryRequest,
  IndicatorSourceKey,
  IndicatorSourceLease,
  IndicatorSourceLiveRequest,
  IndicatorSourceLiveSink,
  IndicatorSourceSnapshot,
  IndicatorSourceSubscription,
} from "./source-engine.js";
