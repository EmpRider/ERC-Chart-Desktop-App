import {
  isIndicatorRuntimeSnapshot,
  isInstalledIndicatorDefinition,
  type Candle,
  type IndicatorParameterValues,
  type IndicatorRuntimeSnapshot,
  type InstrumentId,
  type InstalledIndicatorDefinition,
  type InstalledIndicatorInputDefinition,
  type TimeframeId,
} from "@erc-chart/contracts";
import type {
  IndicatorInputValue,
  IndicatorPluginModule,
  RuntimeIndicatorInstance,
} from "@erc-chart/indicator-sdk";
import type {
  IndicatorWorkerDisposeMessage,
  IndicatorWorkerFailureMessage,
  IndicatorWorkerRequestMessage,
  IndicatorWorkerResultUpdate,
  IndicatorWorkerSuccessMessage,
  IndicatorWorkerSyncMessage,
} from "./index.js";
import { assertDenseSnapshotTimeline } from "./result-validation.js";

interface ActiveInstance {
  readonly signature: string;
  readonly instance: RuntimeIndicatorInstance;
  lastBuilding: Candle | undefined;
  pointCount: number;
}

interface WorkerGlobal {
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  postMessage(
    message: IndicatorWorkerSuccessMessage | IndicatorWorkerFailureMessage,
  ): void;
}

const workerGlobal = globalThis as unknown as WorkerGlobal;
let loadedEntryUrl: string | undefined;
let loadedPlugin: IndicatorPluginModule | undefined;
let active: ActiveInstance | undefined;

function sameCandleIdentity(left: Candle, right: Candle): boolean {
  return (
    left.instrumentId === right.instrumentId &&
    left.timeframeId === right.timeframeId &&
    left.openTimeMs === right.openTimeMs
  );
}

function normalizeInput(
  input: InstalledIndicatorInputDefinition,
  supplied: IndicatorInputValue | undefined,
): IndicatorInputValue {
  const value = supplied ?? input.defaultValue;
  if (input.type === "boolean") {
    if (typeof value !== "boolean")
      throw new Error(`${input.key} must be boolean.`);
    return value;
  }
  if (input.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error(`${input.key} must be a finite number.`);
    if (input.min !== undefined && value < input.min)
      throw new Error(`${input.key} is below its minimum.`);
    if (input.max !== undefined && value > input.max)
      throw new Error(`${input.key} is above its maximum.`);
    return value;
  }
  if (typeof value !== "string" || value.length > 8_192)
    throw new Error(`${input.key} must be a string.`);
  if (
    input.options !== undefined &&
    !input.options.some((option) => option.value === value)
  ) {
    throw new Error(`${input.key} is not one of its supported options.`);
  }
  return value;
}

function normalizeParameters(
  definition: InstalledIndicatorDefinition,
  supplied: IndicatorParameterValues,
): Readonly<Record<string, IndicatorInputValue>> {
  const allowed = new Set(definition.inputs.map((input) => input.key));
  if (Object.keys(supplied).some((key) => !allowed.has(key)))
    throw new Error("Indicator parameters contain an unknown input.");
  return Object.freeze(
    Object.fromEntries(
      definition.inputs.map((input) => [
        input.key,
        normalizeInput(input, supplied[input.key]),
      ]),
    ),
  );
}

function projectSnapshot(
  instance: RuntimeIndicatorInstance,
  expectedOpenTimes: readonly number[],
): IndicatorRuntimeSnapshot {
  const snapshot = instance.snapshot();
  const projected: IndicatorRuntimeSnapshot = {
    points: snapshot.points.map((point) => ({
      openTimeMs: point.openTimeMs,
      values: { ...point.values },
      ...(point.colors === undefined ? {} : { colors: { ...point.colors } }),
      ...(point.sizes === undefined ? {} : { sizes: { ...point.sizes } }),
    })),
    overlays: snapshot.overlays.map((overlay) => ({ ...overlay })),
    signals: (snapshot.signals ?? []).map((signal) => ({ ...signal })),
  };
  if (!isIndicatorRuntimeSnapshot(projected))
    throw new Error(
      "Indicator plugin returned an invalid or oversized snapshot.",
    );
  assertDenseSnapshotTimeline(projected, expectedOpenTimes);
  return projected;
}

function projectPoint(
  point: IndicatorRuntimeSnapshot["points"][number],
): IndicatorRuntimeSnapshot["points"][number] {
  return {
    openTimeMs: point.openTimeMs,
    values: { ...point.values },
    ...(point.colors === undefined ? {} : { colors: { ...point.colors } }),
    ...(point.sizes === undefined ? {} : { sizes: { ...point.sizes } }),
  };
}

function projectIncrementalResult(
  activeInstance: ActiveInstance,
  kind: "building" | "rollover",
  expectedOpenTimes: readonly number[],
): IndicatorWorkerResultUpdate {
  const snapshot = activeInstance.instance.snapshot();
  const expectedPointCount = kind === "building" ? 1 : 2;
  const expectedTotalCount =
    kind === "building"
      ? activeInstance.pointCount
      : activeInstance.pointCount + 1;
  if (
    expectedOpenTimes.length !== expectedPointCount ||
    snapshot.points.length !== expectedTotalCount ||
    snapshot.points.length > 100_000 ||
    snapshot.overlays.length > 10_000 ||
    (snapshot.signals?.length ?? 0) > 10_000
  ) {
    throw new Error(
      "Indicator plugin returned an invalid incremental result shape.",
    );
  }
  const points = expectedOpenTimes.map((openTimeMs, offset) => {
    const point =
      snapshot.points[snapshot.points.length - expectedPointCount + offset];
    if (point === undefined || point.openTimeMs !== openTimeMs) {
      throw new Error(
        "Indicator plugin incremental result does not match the candle tail.",
      );
    }
    return projectPoint(point);
  });
  const projected: IndicatorRuntimeSnapshot = {
    points,
    overlays: snapshot.overlays.map((overlay) => ({ ...overlay })),
    signals: (snapshot.signals ?? []).map((signal) => ({ ...signal })),
  };
  if (!isIndicatorRuntimeSnapshot(projected)) {
    throw new Error("Indicator plugin returned an invalid incremental result.");
  }
  activeInstance.pointCount = expectedTotalCount;
  return {
    kind,
    points: projected.points,
    overlays: projected.overlays,
    signals: projected.signals,
  };
}

async function pluginFor(
  message: IndicatorWorkerSyncMessage,
): Promise<IndicatorPluginModule> {
  if (loadedPlugin !== undefined && loadedEntryUrl === message.runtimeEntryUrl)
    return loadedPlugin;
  active?.instance.dispose();
  active = undefined;
  const moduleValue: unknown = await import(message.runtimeEntryUrl);
  if (typeof moduleValue !== "object" || moduleValue === null)
    throw new Error("Indicator module is invalid.");
  const candidate = (moduleValue as { readonly default?: unknown }).default;
  if (typeof candidate !== "object" || candidate === null)
    throw new Error("Indicator module must export a default plugin object.");
  const plugin = candidate as IndicatorPluginModule;
  if (
    !isInstalledIndicatorDefinition(plugin.definition) ||
    typeof plugin.createInstance !== "function" ||
    plugin.definition.id !== message.definitionId ||
    !plugin.definition.id.startsWith(`${message.pluginId}.`)
  ) {
    throw new Error(
      "Indicator module definition does not match its installed manifest.",
    );
  }
  loadedEntryUrl = message.runtimeEntryUrl;
  loadedPlugin = plugin;
  return plugin;
}

function signatureFor(
  message: IndicatorWorkerSyncMessage,
  parameters: Readonly<Record<string, IndicatorInputValue>>,
): string {
  return JSON.stringify({
    pluginId: message.pluginId,
    definitionId: message.definitionId,
    instrumentId: message.instrumentId,
    timeframeId: message.timeframeId,
    parameters,
  });
}

async function execute(
  message: IndicatorWorkerSyncMessage,
): Promise<IndicatorWorkerResultUpdate> {
  const plugin = await pluginFor(message);
  const parameters = normalizeParameters(
    plugin.definition as InstalledIndicatorDefinition,
    message.parameters,
  );
  const signature = signatureFor(message, parameters);
  if (active !== undefined && active.signature === signature) {
    if (message.data.kind === "building") {
      if (
        active.lastBuilding === undefined ||
        !sameCandleIdentity(active.lastBuilding, message.data.candle)
      ) {
        throw new Error("Building-bar delta does not match the active candle.");
      }
      active.instance.onBuildingBar(message.data.candle);
      active.lastBuilding = message.data.candle;
      return projectIncrementalResult(active, "building", [
        message.data.candle.openTimeMs,
      ]);
    }
    if (message.data.kind === "rollover") {
      if (
        active.lastBuilding === undefined ||
        !sameCandleIdentity(active.lastBuilding, message.data.finalized) ||
        message.data.building.openTimeMs <= message.data.finalized.openTimeMs
      ) {
        throw new Error(
          "Finalized-bar delta does not match the active candle.",
        );
      }
      active.instance.onFinalizedBar(message.data.finalized);
      active.instance.onBuildingBar(message.data.building);
      active.lastBuilding = message.data.building;
      return projectIncrementalResult(active, "rollover", [
        message.data.finalized.openTimeMs,
        message.data.building.openTimeMs,
      ]);
    }
  }
  if (message.data.kind !== "snapshot" && message.data.kind !== "rebuild") {
    throw new Error(
      "Indicator worker requires a history snapshot before incremental updates.",
    );
  }
  active?.instance.dispose();
  const instance = plugin.createInstance(parameters, {
    instrumentId: message.instrumentId as InstrumentId,
    timeframeId: message.timeframeId as TimeframeId,
  });
  instance.onHistory(message.data.candles);
  const snapshot = projectSnapshot(
    instance,
    message.data.candles.map(({ openTimeMs }) => openTimeMs),
  );
  active = {
    signature,
    instance,
    lastBuilding: message.data.candles.at(-1),
    pointCount: snapshot.points.length,
  };
  return { kind: "snapshot", snapshot };
}

function isCandle(value: unknown): value is Candle {
  if (typeof value !== "object" || value === null) return false;
  const candle = value as Partial<Candle>;
  return (
    typeof candle.instrumentId === "string" &&
    typeof candle.timeframeId === "string" &&
    Number.isSafeInteger(candle.openTimeMs) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    (candle.volume === undefined || Number.isFinite(candle.volume))
  );
}

function isDataUpdate(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  if (data.kind === "snapshot" || data.kind === "rebuild") {
    return Array.isArray(data.candles) && data.candles.every(isCandle);
  }
  if (data.kind === "building") return isCandle(data.candle);
  return (
    data.kind === "rollover" &&
    isCandle(data.finalized) &&
    isCandle(data.building)
  );
}

function isSyncMessage(value: unknown): value is IndicatorWorkerSyncMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<IndicatorWorkerSyncMessage>;
  return (
    message.type === "sync" &&
    typeof message.instanceId === "string" &&
    typeof message.runtimeEntryUrl === "string" &&
    typeof message.pluginId === "string" &&
    typeof message.definitionId === "string" &&
    typeof message.instrumentId === "string" &&
    typeof message.timeframeId === "string" &&
    Number.isSafeInteger(message.sequence) &&
    Number(message.sequence) > 0 &&
    Number.isSafeInteger(message.dataRevision) &&
    Number(message.dataRevision) >= 0 &&
    Number.isSafeInteger(message.configGeneration) &&
    Number(message.configGeneration) >= 0 &&
    typeof message.parameters === "object" &&
    message.parameters !== null &&
    isDataUpdate(message.data)
  );
}

function dispose(message: IndicatorWorkerDisposeMessage): void {
  if (active !== undefined) {
    active.instance.dispose();
    active = undefined;
  }
  loadedEntryUrl = undefined;
  loadedPlugin = undefined;
  void message.instanceId;
}

workerGlobal.onmessage = (event): void => {
  const message = event.data as IndicatorWorkerRequestMessage;
  if (message?.type === "dispose") {
    dispose(message);
    return;
  }
  if (!isSyncMessage(message)) return;
  void execute(message)
    .then((result) => {
      workerGlobal.postMessage({
        type: "result",
        instanceId: message.instanceId,
        sequence: message.sequence,
        dataRevision: message.dataRevision,
        configGeneration: message.configGeneration,
        result,
      });
    })
    .catch((error: unknown) => {
      workerGlobal.postMessage({
        type: "error",
        instanceId: message.instanceId,
        sequence: message.sequence,
        dataRevision: message.dataRevision,
        configGeneration: message.configGeneration,
        code: "INDICATOR_WORKER_EXECUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    });
};
