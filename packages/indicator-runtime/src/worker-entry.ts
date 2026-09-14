import {
  isIndicatorRuntimeSnapshot,
  isIndicatorWorkerCandleSnapshot,
  isInstalledIndicatorDefinition,
  materializeIndicatorWorkerCandleSnapshot,
  type Candle,
  type IndicatorParameterValues,
  type IndicatorRuntimePoint,
  type IndicatorRuntimeSnapshot,
  type InstrumentId,
  type InstalledIndicatorDefinition,
  type TimeframeId,
} from "@erc-chart/contracts";
import type {
  IndicatorWorkerDependencySnapshot,
  IndicatorWorkerDisposeMessage,
  IndicatorWorkerFailureMessage,
  IndicatorWorkerRequestMessage,
  IndicatorWorkerResultUpdate,
  IndicatorWorkerSuccessMessage,
  IndicatorWorkerSyncMessage,
} from "./index.js";
import {
  INDICATOR_WORKER_MAX_DEPENDENCY_POINTS,
  normalizeIndicatorParameters,
} from "./index.js";
import { assertDenseSnapshotTimeline } from "./result-validation.js";

interface RuntimeIndicatorSnapshot extends IndicatorRuntimeSnapshot {
  readonly visualRevision?: number;
}

interface RuntimeIndicatorInstance {
  readonly onHistory: (candles: readonly Candle[]) => void;
  readonly onBuildingBar: (candle: Candle) => void;
  readonly onFinalizedBar: (candle: Candle) => void;
  readonly updateDependencyInputs?: (
    updates: Readonly<Record<string, readonly IndicatorRuntimePoint[]>>,
  ) => void;
  readonly dispose: () => void;
  readonly snapshot: () => RuntimeIndicatorSnapshot;
}

interface IndicatorPluginModule {
  readonly definition: InstalledIndicatorDefinition;
  readonly createInstance: (
    parameters: IndicatorParameterValues,
    context: {
      readonly instrumentId: InstrumentId;
      readonly timeframeId: TimeframeId;
      readonly sourceCandles?: Readonly<Record<string, readonly Candle[]>>;
      readonly sourceMetadata?: Readonly<
        Record<
          string,
          {
            readonly providerProfileId: string;
            readonly instrumentId: string;
            readonly activeTimeframeId: string;
            readonly generation: number;
            readonly revision: number;
            readonly finalizedCount: number;
            readonly provenance: {
              readonly kind: "market" | "synthetic";
              readonly candleType: "standard" | "heikin-ashi";
            };
          }
        >
      >;
      readonly dependencyInputs?: Readonly<
        Record<string, readonly IndicatorRuntimePoint[]>
      >;
    },
  ) => RuntimeIndicatorInstance;
}

interface ActiveInstance {
  readonly signature: string;
  readonly instance: RuntimeIndicatorInstance;
  lastBuilding: Candle | undefined;
  pointCount: number;
  visualRevision: number | undefined;
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

function normalizeParameters(
  definition: InstalledIndicatorDefinition,
  supplied: IndicatorParameterValues,
): IndicatorParameterValues {
  return normalizeIndicatorParameters(definition, supplied);
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
  if (
    snapshot.visualRevision !== undefined &&
    (!Number.isSafeInteger(snapshot.visualRevision) ||
      snapshot.visualRevision < 0)
  )
    throw new Error(
      "Indicator visual revision must be a non-negative safe integer.",
    );
  const visualsChanged =
    snapshot.visualRevision === undefined ||
    snapshot.visualRevision !== activeInstance.visualRevision;
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
    overlays: visualsChanged
      ? snapshot.overlays.map((overlay) => ({ ...overlay }))
      : [],
    signals: visualsChanged
      ? (snapshot.signals ?? []).map((signal) => ({ ...signal }))
      : [],
  };
  if (!isIndicatorRuntimeSnapshot(projected)) {
    throw new Error("Indicator plugin returned an invalid incremental result.");
  }
  activeInstance.pointCount = expectedTotalCount;
  activeInstance.visualRevision = snapshot.visualRevision;
  return {
    kind,
    points: projected.points,
    ...(visualsChanged
      ? { overlays: projected.overlays, signals: projected.signals }
      : {}),
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
  parameters: IndicatorParameterValues,
): string {
  return JSON.stringify({
    pluginId: message.pluginId,
    definitionId: message.definitionId,
    instrumentId: message.instrumentId,
    timeframeId: message.timeframeId,
    parameters,
    dependencies: message.dependencies?.map(
      ({
        inputKey,
        instanceId,
        outputKey,
        sourceGeneration,
        configGeneration,
      }) => ({
        inputKey,
        instanceId,
        outputKey,
        sourceGeneration,
        configGeneration,
      }),
    ),
  });
}

function applyDependencyUpdates(
  instance: RuntimeIndicatorInstance,
  dependencies: IndicatorWorkerSyncMessage["dependencies"],
): void {
  if (dependencies === undefined || dependencies.length === 0) return;
  if (instance.updateDependencyInputs === undefined) {
    throw new Error(
      "Indicator runtime does not support live dependency input updates.",
    );
  }
  instance.updateDependencyInputs(
    Object.fromEntries(
      dependencies.map((dependency) => [
        dependency.inputKey,
        dependency.points.map((point) => ({
          openTimeMs: point.openTimeMs,
          values: { ...point.values },
          ...(point.colors === undefined
            ? {}
            : { colors: { ...point.colors } }),
          ...(point.sizes === undefined ? {} : { sizes: { ...point.sizes } }),
        })),
      ]),
    ),
  );
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
      applyDependencyUpdates(active.instance, message.dependencies);
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
      applyDependencyUpdates(active.instance, message.dependencies);
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
  const historyCandles = materializeIndicatorWorkerCandleSnapshot(
    message.data.snapshot,
    message.instrumentId as InstrumentId,
    message.timeframeId as TimeframeId,
  );
  const instance = plugin.createInstance(parameters, {
    instrumentId: message.instrumentId as InstrumentId,
    timeframeId: message.timeframeId as TimeframeId,
    ...(message.sources === undefined
      ? {}
      : {
          sourceCandles: Object.fromEntries(
            message.sources.map((source) => [
              source.timeframeId,
              materializeIndicatorWorkerCandleSnapshot(
                source.snapshot,
                source.instrumentId as InstrumentId,
                (source.activeTimeframeId ?? source.timeframeId) as TimeframeId,
              ),
            ]),
          ),
          sourceMetadata: Object.fromEntries(
            message.sources.map((source) => [
              source.timeframeId,
              {
                providerProfileId: source.providerProfileId,
                instrumentId: source.instrumentId,
                activeTimeframeId:
                  source.activeTimeframeId ?? source.timeframeId,
                generation: source.generation,
                revision: source.revision,
                finalizedCount: source.finalizedCount,
                provenance: source.provenance,
              },
            ]),
          ),
        }),
    ...(message.dependencies === undefined
      ? {}
      : {
          dependencyInputs: Object.fromEntries(
            message.dependencies.map((dependency) => [
              dependency.inputKey,
              dependency.points.map((point) => ({
                openTimeMs: point.openTimeMs,
                values: { ...point.values },
                ...(point.colors === undefined
                  ? {}
                  : { colors: { ...point.colors } }),
                ...(point.sizes === undefined
                  ? {}
                  : { sizes: { ...point.sizes } }),
              })),
            ]),
          ),
        }),
  });
  instance.onHistory(historyCandles);
  const snapshot = projectSnapshot(instance, [
    ...message.data.snapshot.openTimeMs,
  ]);
  active = {
    signature,
    instance,
    lastBuilding: historyCandles.at(-1),
    pointCount: snapshot.points.length,
    visualRevision: instance.snapshot().visualRevision,
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
    return isIndicatorWorkerCandleSnapshot(data.snapshot);
  }
  if (data.kind === "building") return isCandle(data.candle);
  return (
    data.kind === "rollover" &&
    isCandle(data.finalized) &&
    isCandle(data.building)
  );
}

function isSourceSnapshot(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const source = value as {
    readonly providerProfileId?: unknown;
    readonly instrumentId?: unknown;
    readonly timeframeId?: unknown;
    readonly activeTimeframeId?: unknown;
    readonly snapshot?: unknown;
    readonly provenance?: unknown;
    readonly generation?: unknown;
    readonly revision?: unknown;
    readonly finalizedCount?: unknown;
  };
  const activeTimeframeId =
    source.activeTimeframeId === undefined
      ? source.timeframeId
      : source.activeTimeframeId;
  return (
    typeof source.providerProfileId === "string" &&
    source.providerProfileId.length > 0 &&
    source.providerProfileId.length <= 256 &&
    typeof source.instrumentId === "string" &&
    source.instrumentId.length > 0 &&
    source.instrumentId.length <= 256 &&
    typeof source.timeframeId === "string" &&
    source.timeframeId.length > 0 &&
    typeof activeTimeframeId === "string" &&
    activeTimeframeId.length > 0 &&
    typeof source.provenance === "object" &&
    source.provenance !== null &&
    (((source.provenance as { readonly kind?: unknown }).kind === "market" &&
      (source.provenance as { readonly candleType?: unknown }).candleType ===
        "standard") ||
      ((source.provenance as { readonly kind?: unknown }).kind ===
        "synthetic" &&
        (source.provenance as { readonly candleType?: unknown }).candleType ===
          "heikin-ashi")) &&
    Number.isSafeInteger(source.generation) &&
    Number(source.generation) >= 0 &&
    Number.isSafeInteger(source.revision) &&
    Number(source.revision) >= 0 &&
    Number.isSafeInteger(source.finalizedCount) &&
    Number(source.finalizedCount) >= 0 &&
    isIndicatorWorkerCandleSnapshot(source.snapshot) &&
    Number(source.finalizedCount) <= source.snapshot.openTimeMs.length
  );
}

function isDependencySnapshot(
  value: unknown,
): value is IndicatorWorkerDependencySnapshot {
  if (typeof value !== "object" || value === null) return false;
  const dependency = value as {
    readonly inputKey?: unknown;
    readonly instanceId?: unknown;
    readonly outputKey?: unknown;
    readonly sourceGeneration?: unknown;
    readonly sourceRevision?: unknown;
    readonly configGeneration?: unknown;
    readonly outputRevision?: unknown;
    readonly points?: unknown;
  };
  return (
    typeof dependency.inputKey === "string" &&
    dependency.inputKey.length > 0 &&
    typeof dependency.instanceId === "string" &&
    dependency.instanceId.length > 0 &&
    typeof dependency.outputKey === "string" &&
    dependency.outputKey.length > 0 &&
    Number.isSafeInteger(dependency.sourceGeneration) &&
    Number(dependency.sourceGeneration) >= 0 &&
    Number.isSafeInteger(dependency.sourceRevision) &&
    Number(dependency.sourceRevision) >= 0 &&
    Number.isSafeInteger(dependency.configGeneration) &&
    Number(dependency.configGeneration) >= 0 &&
    Number.isSafeInteger(dependency.outputRevision) &&
    Number(dependency.outputRevision) >= 0 &&
    Array.isArray(dependency.points) &&
    isIndicatorRuntimeSnapshot({
      points: dependency.points,
      overlays: [],
      signals: [],
    }) &&
    dependency.points.every(
      (point) =>
        Object.keys(point.values).length === 1 &&
        Object.prototype.hasOwnProperty.call(
          point.values,
          dependency.outputKey as string,
        ),
    )
  );
}

function isDependencySnapshotBatch(
  value: unknown,
): value is readonly IndicatorWorkerDependencySnapshot[] {
  if (!Array.isArray(value) || value.length > 64) return false;
  let pointCount = 0;
  for (const dependency of value) {
    if (!isDependencySnapshot(dependency)) return false;
    pointCount += dependency.points.length;
    if (pointCount > INDICATOR_WORKER_MAX_DEPENDENCY_POINTS) return false;
  }
  return true;
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
    (message.sources === undefined ||
      (Array.isArray(message.sources) &&
        message.sources.every(isSourceSnapshot))) &&
    (message.dependencies === undefined ||
      isDependencySnapshotBatch(message.dependencies)) &&
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
