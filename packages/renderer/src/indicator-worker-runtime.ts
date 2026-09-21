import type {
  Candle,
  IndicatorRuntimeSyncRequest,
  ProviderHistoryLoadRequest,
  ProviderLiveEvent,
  ProviderLiveRequest,
} from "@erc-chart/contracts";
import { createIndicatorWorkerCandleSnapshot } from "@erc-chart/contracts";
import {
  createIndicatorSourceEngine,
  createIndicatorWorkerSupervisor,
  IndicatorWorkerRuntimeError,
  type IndicatorSourceDataService,
  type IndicatorSourceLease,
  type IndicatorSourceSnapshot,
  type IndicatorCandleType,
  type IndicatorWorkerSupervisor,
  type IndicatorWorkerDataUpdate,
  type IndicatorWorkerDependencySnapshot,
  type IndicatorWorkerResultUpdate,
  type IndicatorWorkerSupervisorOptions,
} from "@erc-chart/indicator-runtime";

export interface BrowserIndicatorSyncRequest extends Omit<
  IndicatorRuntimeSyncRequest,
  "candles"
> {
  readonly runtimeEntryUrl: string;
  readonly providerProfileId?: string;
  readonly candleType?: IndicatorCandleType;
  readonly sourceTimeframeIds?: readonly string[];
  readonly sourceTimeframes?: readonly {
    readonly requestedTimeframeId: string;
    readonly activeTimeframeId: string;
  }[];
  readonly dependencies?: readonly IndicatorWorkerDependencySnapshot[];
  readonly data: BrowserIndicatorDataUpdate;
  readonly rebuildCandles: () => readonly IndicatorRuntimeSyncRequest["candles"][number][];
  readonly rebuildDependencies?: () => readonly IndicatorWorkerDependencySnapshot[];
  readonly dataRevision: number;
  readonly configGeneration: number;
}

export type BrowserIndicatorDataUpdate =
  | {
      readonly kind: "snapshot";
      readonly candles: readonly Candle[];
    }
  | {
      readonly kind: "rebuild";
      readonly candles: readonly Candle[];
    }
  | Extract<
      IndicatorWorkerDataUpdate,
      { readonly kind: "building" | "rollover" }
    >;

export interface BrowserIndicatorRuntimeOptions extends IndicatorWorkerSupervisorOptions {
  readonly sourceDataService?: IndicatorSourceDataService;
}

export interface RendererIndicatorSourceBridge {
  readonly requestProviderHistory: (
    request: ProviderHistoryLoadRequest,
  ) => Promise<readonly Candle[]>;
  readonly subscribeProviderData: (
    request: ProviderLiveRequest,
    listener: (event: ProviderLiveEvent) => void,
  ) => Promise<() => Promise<void>>;
}

export interface BrowserIndicatorRuntime {
  readonly sync: (
    request: BrowserIndicatorSyncRequest,
  ) => Promise<IndicatorWorkerResultUpdate>;
  readonly disposeInstance: (instanceId: string) => void;
  readonly dispose: () => void;
}

function dataUsesTimeframe(
  data: BrowserIndicatorDataUpdate,
  timeframeId: string,
): boolean {
  if (data.kind === "building") return data.candle.timeframeId === timeframeId;
  if (data.kind === "rollover")
    return (
      data.finalized.timeframeId === timeframeId &&
      data.building.timeframeId === timeframeId
    );
  return data.candles.every((candle) => candle.timeframeId === timeframeId);
}

function requiresProviderBackedSource(
  request: BrowserIndicatorSyncRequest,
): boolean {
  if ((request.candleType ?? "standard") !== "standard") return true;
  if ((request.sourceTimeframeIds?.length ?? 0) > 0) return true;
  if ((request.sourceTimeframes?.length ?? 0) > 0) return true;
  return !dataUsesTimeframe(request.data, request.timeframeId);
}

export function createRendererIndicatorSourceDataService(
  bridge: RendererIndicatorSourceBridge,
): IndicatorSourceDataService {
  const dataService: IndicatorSourceDataService = {
    requestHistory: (providerProfileId, request) =>
      bridge.requestProviderHistory({
        profileId: providerProfileId,
        instrumentId: request.instrumentId,
        timeframeId: request.timeframeId,
        limit: request.limit,
      }),
    subscribe: async (providerProfileId, request, sink) => {
      const unsubscribe = await bridge.subscribeProviderData(
        {
          profileId: providerProfileId,
          instrumentId: request.instrumentId,
          timeframeId: request.timeframeId,
        },
        (event) => {
          if (event.type === "candles") {
            sink.onCandles(event.candles, event.series);
            return;
          }
          sink.onError(event.code);
        },
      );
      return Object.freeze({ unsubscribe });
    },
  };
  return Object.freeze(dataService);
}

export function createBrowserIndicatorRuntime(
  options: BrowserIndicatorRuntimeOptions = {},
): BrowserIndicatorRuntime {
  const supervisor: IndicatorWorkerSupervisor =
    createIndicatorWorkerSupervisor(options);
  const sourceEngine =
    options.sourceDataService === undefined
      ? undefined
      : createIndicatorSourceEngine(options.sourceDataService);
  const sourceLeases = new Map<string, Map<string, IndicatorSourceLease>>();
  const sourceAcquisitionChains = new Map<string, Promise<void>>();
  const sourceInstanceEpochs = new Map<string, number>();
  const sourceVersions = new Map<string, string>();

  const sourceInstanceEpoch = (instanceId: string): number =>
    sourceInstanceEpochs.get(instanceId) ?? 0;

  const assertSourceInstanceEpoch = (
    instanceId: string,
    expectedEpoch: number,
  ): void => {
    if (sourceInstanceEpoch(instanceId) !== expectedEpoch)
      throw new Error("Indicator source acquisition was superseded.");
  };

  const reconcileSources = async (
    request: BrowserIndicatorSyncRequest,
    expectedEpoch: number,
  ): Promise<ReadonlyMap<string, IndicatorSourceLease> | undefined> => {
    assertSourceInstanceEpoch(request.instanceId, expectedEpoch);
    if (
      sourceEngine === undefined ||
      request.providerProfileId === undefined ||
      request.providerProfileId.length === 0 ||
      !requiresProviderBackedSource(request)
    ) {
      const current = sourceLeases.get(request.instanceId);
      sourceLeases.delete(request.instanceId);
      if (current !== undefined)
        for (const source of current.values()) await source.release();
      assertSourceInstanceEpoch(request.instanceId, expectedEpoch);
      return undefined;
    }
    const timeframeIds = [
      ...new Set([
        request.timeframeId,
        ...(request.sourceTimeframeIds ?? []),
        ...(request.sourceTimeframes ?? []).map(
          ({ activeTimeframeId }) => activeTimeframeId,
        ),
      ]),
    ];
    const candleType = request.candleType ?? "standard";
    const current = sourceLeases.get(request.instanceId) ?? new Map();
    const next = new Map<string, IndicatorSourceLease>();
    try {
      for (const timeframeId of timeframeIds) {
        const identity = JSON.stringify([
          request.providerProfileId,
          request.instrumentId,
          timeframeId,
          candleType,
        ]);
        const existing = current.get(identity);
        const lease =
          existing ??
          (await sourceEngine.acquire({
            providerProfileId: request.providerProfileId,
            instrumentId: request.instrumentId,
            timeframeId,
            candleType,
          }));
        next.set(identity, lease);
        assertSourceInstanceEpoch(request.instanceId, expectedEpoch);
      }
    } catch (error) {
      for (const [identity, lease] of next) {
        if (!current.has(identity))
          await lease.release().catch(() => undefined);
      }
      throw error;
    }
    assertSourceInstanceEpoch(request.instanceId, expectedEpoch);
    sourceLeases.set(request.instanceId, next);
    for (const [identity, lease] of current) {
      if (!next.has(identity)) {
        await lease.release();
      }
    }
    assertSourceInstanceEpoch(request.instanceId, expectedEpoch);
    return new Map(
      [...next.values()].map((lease) => [lease.key.timeframeId, lease]),
    );
  };

  const sourcesFor = (
    request: BrowserIndicatorSyncRequest,
    expectedEpoch: number,
  ): Promise<ReadonlyMap<string, IndicatorSourceLease> | undefined> => {
    const previous = sourceAcquisitionChains.get(request.instanceId);
    const operation = (previous ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => reconcileSources(request, expectedEpoch));
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    sourceAcquisitionChains.set(request.instanceId, settled);
    return operation.finally(() => {
      if (sourceAcquisitionChains.get(request.instanceId) === settled)
        sourceAcquisitionChains.delete(request.instanceId);
    });
  };

  const sourceVersion = (
    snapshots: ReadonlyMap<string, IndicatorSourceSnapshot>,
  ): string =>
    JSON.stringify(
      [...snapshots.values()].map((snapshot) => {
        return [
          snapshot.key.providerProfileId,
          snapshot.key.instrumentId,
          snapshot.key.timeframeId,
          snapshot.key.candleType,
          snapshot.generation,
          snapshot.revision,
        ];
      }),
    );

  return {
    sync: async (request): Promise<IndicatorWorkerResultUpdate> => {
      const execute = (
        data: BrowserIndicatorDataUpdate,
        sources: readonly {
          readonly providerProfileId: string;
          readonly instrumentId: string;
          readonly timeframeId: string;
          readonly activeTimeframeId?: string;
          readonly candles: readonly Candle[];
          readonly provenance: IndicatorSourceSnapshot["provenance"];
          readonly generation: number;
          readonly revision: number;
          readonly finalizedCount: number;
        }[] = [],
        sourceProvenance?: IndicatorSourceSnapshot["provenance"],
        dependencies = request.dependencies,
      ) => {
        let workerData: IndicatorWorkerDataUpdate;
        if (data.kind === "snapshot" || data.kind === "rebuild") {
          workerData = {
            kind: data.kind,
            snapshot: createIndicatorWorkerCandleSnapshot(data.candles),
          };
        } else if (data.kind === "building") {
          workerData = data;
        } else {
          workerData = data;
        }
        const workerSources = sources.map(({ candles, ...source }) => ({
          ...source,
          snapshot: createIndicatorWorkerCandleSnapshot(candles),
        }));
        return supervisor.sync({
          instanceId: request.instanceId,
          runtimeEntryUrl: request.runtimeEntryUrl,
          pluginId: request.pluginId,
          definitionId: request.definitionId,
          instrumentId: request.instrumentId,
          timeframeId: request.timeframeId,
          parameters: request.parameters,
          ...(sourceProvenance === undefined ? {} : { sourceProvenance }),
          ...(workerSources.length === 0 ? {} : { sources: workerSources }),
          ...(dependencies === undefined ? {} : { dependencies }),
          data: workerData,
          dataRevision: request.dataRevision,
          configGeneration: request.configGeneration,
        });
      };
      const expectedSourceEpoch = sourceInstanceEpoch(request.instanceId);
      const sources = await sourcesFor(request, expectedSourceEpoch);
      assertSourceInstanceEpoch(request.instanceId, expectedSourceEpoch);
      let result;
      if (sources !== undefined) {
        const snapshots = new Map(
          [...sources].map(([timeframeId, lease]) => [
            timeframeId,
            lease.snapshot(),
          ]),
        );
        const baseSnapshot = snapshots.get(request.timeframeId);
        if (baseSnapshot === undefined)
          throw new Error("Indicator base source was not acquired.");
        const sourceMappings =
          request.sourceTimeframes ??
          (request.sourceTimeframeIds ?? []).map((timeframeId) => ({
            requestedTimeframeId: timeframeId,
            activeTimeframeId: timeframeId,
          }));
        const auxiliarySources = sourceMappings.map(
          ({ requestedTimeframeId, activeTimeframeId }) => {
            const snapshot = snapshots.get(activeTimeframeId);
            if (snapshot === undefined)
              throw new Error("Indicator auxiliary source was not acquired.");
            return {
              providerProfileId: snapshot.key.providerProfileId,
              instrumentId: snapshot.key.instrumentId,
              timeframeId: requestedTimeframeId,
              ...(activeTimeframeId === requestedTimeframeId
                ? {}
                : { activeTimeframeId }),
              candles: snapshot.candles,
              provenance: snapshot.provenance,
              generation: snapshot.generation,
              revision: snapshot.revision,
              finalizedCount: snapshot.finalizedCount,
            };
          },
        );
        const baseWorkerSource = {
          providerProfileId: baseSnapshot.key.providerProfileId,
          instrumentId: baseSnapshot.key.instrumentId,
          timeframeId: request.timeframeId,
          candles: baseSnapshot.candles,
          provenance: baseSnapshot.provenance,
          generation: baseSnapshot.generation,
          revision: baseSnapshot.revision,
          finalizedCount: baseSnapshot.finalizedCount,
        };
        const workerSources = [
          baseWorkerSource,
          ...auxiliarySources.filter(
            (source) => source.timeframeId !== request.timeframeId,
          ),
        ];
        const version = sourceVersion(snapshots);
        const previousVersion = sourceVersions.get(request.instanceId);
        const dataUsesBaseTimeframe =
          request.data.kind === "building"
            ? request.data.candle.timeframeId === request.timeframeId
            : request.data.kind === "rollover"
              ? request.data.finalized.timeframeId === request.timeframeId &&
                request.data.building.timeframeId === request.timeframeId
              : false;
        const canUseRawBaseDelta =
          dataUsesBaseTimeframe && baseSnapshot.key.candleType === "standard";
        const rebuild = () =>
          execute(
            {
              kind: "rebuild",
              candles: baseSnapshot.candles,
            },
            workerSources,
            baseSnapshot.provenance,
            request.rebuildDependencies?.() ?? request.dependencies,
          );
        if (
          previousVersion !== version ||
          !canUseRawBaseDelta ||
          request.data.kind === "snapshot" ||
          request.data.kind === "rebuild"
        ) {
          result = await rebuild();
          sourceVersions.set(request.instanceId, version);
        } else {
          try {
            result = await execute(
              request.data,
              auxiliarySources,
              baseSnapshot.provenance,
            );
          } catch (error) {
            if (
              !(error instanceof IndicatorWorkerRuntimeError) ||
              error.code !== "INDICATOR_WORKER_SNAPSHOT_REQUIRED"
            ) {
              throw error;
            }
            result = await rebuild();
            sourceVersions.set(request.instanceId, version);
          }
        }
      } else {
        sourceVersions.delete(request.instanceId);
        try {
          result = await execute(request.data);
        } catch (error) {
          if (
            !(error instanceof IndicatorWorkerRuntimeError) ||
            error.code !== "INDICATOR_WORKER_SNAPSHOT_REQUIRED"
          ) {
            throw error;
          }
          result = await execute(
            {
              kind: "rebuild",
              candles: request.rebuildCandles(),
            },
            [],
            undefined,
            request.rebuildDependencies?.() ?? request.dependencies,
          );
        }
      }
      if (
        result.instanceId !== request.instanceId ||
        result.dataRevision !== request.dataRevision ||
        result.configGeneration !== request.configGeneration
      ) {
        throw new Error("Indicator worker returned a stale result generation.");
      }
      return result.result;
    },
    disposeInstance: (instanceId): void => {
      supervisor.disposeInstance(instanceId);
      sourceInstanceEpochs.set(instanceId, sourceInstanceEpoch(instanceId) + 1);
      sourceVersions.delete(instanceId);
      const sources = sourceLeases.get(instanceId);
      sourceLeases.delete(instanceId);
      if (sources !== undefined)
        for (const source of sources.values())
          void source.release().catch(() => undefined);
    },
    dispose: (): void => {
      supervisor.dispose();
      sourceLeases.clear();
      sourceInstanceEpochs.clear();
      sourceVersions.clear();
      sourceAcquisitionChains.clear();
      void sourceEngine?.dispose().catch(() => undefined);
    },
  };
}
