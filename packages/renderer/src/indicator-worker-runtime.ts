import type {
  Candle,
  IndicatorRuntimeSyncRequest,
  ProviderHistoryLoadRequest,
  ProviderLiveEvent,
  ProviderLiveRequest,
} from "@erc-chart/contracts";
import {
  createIndicatorSourceEngine,
  createIndicatorWorkerSupervisor,
  IndicatorWorkerRuntimeError,
  type IndicatorSourceDataService,
  type IndicatorSourceLease,
  type IndicatorWorkerSupervisor,
  type IndicatorWorkerDataUpdate,
  type IndicatorWorkerResultUpdate,
  type IndicatorWorkerSupervisorOptions,
} from "@erc-chart/indicator-runtime";

export interface BrowserIndicatorSyncRequest extends Omit<
  IndicatorRuntimeSyncRequest,
  "candles"
> {
  readonly runtimeEntryUrl: string;
  readonly providerProfileId?: string;
  readonly sourceTimeframeIds?: readonly string[];
  readonly sourceTimeframes?: readonly {
    readonly requestedTimeframeId: string;
    readonly activeTimeframeId: string;
  }[];
  readonly data: IndicatorWorkerDataUpdate;
  readonly rebuildCandles: () => readonly IndicatorRuntimeSyncRequest["candles"][number][];
  readonly dataRevision: number;
  readonly configGeneration: number;
}

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

  const sourcesFor = async (
    request: BrowserIndicatorSyncRequest,
  ): Promise<ReadonlyMap<string, IndicatorSourceLease> | undefined> => {
    if (
      sourceEngine === undefined ||
      request.providerProfileId === undefined ||
      request.providerProfileId.length === 0
    ) {
      const current = sourceLeases.get(request.instanceId);
      sourceLeases.delete(request.instanceId);
      if (current !== undefined)
        for (const source of current.values()) await source.release();
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
    const current = sourceLeases.get(request.instanceId) ?? new Map();
    const next = new Map<string, IndicatorSourceLease>();
    try {
      for (const timeframeId of timeframeIds) {
        const identity = JSON.stringify([
          request.providerProfileId,
          request.instrumentId,
          timeframeId,
          "standard",
        ]);
        const existing = current.get(identity);
        const lease =
          existing ??
          (await sourceEngine.acquire({
            providerProfileId: request.providerProfileId,
            instrumentId: request.instrumentId,
            timeframeId,
            candleType: "standard",
          }));
        next.set(identity, lease);
      }
    } catch (error) {
      for (const [identity, lease] of next) {
        if (!current.has(identity))
          await lease.release().catch(() => undefined);
      }
      throw error;
    }
    sourceLeases.set(request.instanceId, next);
    for (const [identity, lease] of current) {
      if (!next.has(identity)) await lease.release();
    }
    return new Map(
      [...next.values()].map((lease) => [lease.key.timeframeId, lease]),
    );
  };

  return {
    sync: async (request): Promise<IndicatorWorkerResultUpdate> => {
      const execute = (
        data: IndicatorWorkerDataUpdate,
        sources: readonly {
          readonly timeframeId: string;
          readonly candles: readonly Candle[];
        }[] = [],
      ) =>
        supervisor.sync({
          instanceId: request.instanceId,
          runtimeEntryUrl: request.runtimeEntryUrl,
          pluginId: request.pluginId,
          definitionId: request.definitionId,
          instrumentId: request.instrumentId,
          timeframeId: request.timeframeId,
          parameters: request.parameters,
          ...(sources.length === 0 ? {} : { sources }),
          data,
          dataRevision: request.dataRevision,
          configGeneration: request.configGeneration,
        });
      const sources = await sourcesFor(request);
      let result;
      if (sources !== undefined) {
        const base = sources.get(request.timeframeId);
        if (base === undefined)
          throw new Error("Indicator base source was not acquired.");
        const sourceMappings =
          request.sourceTimeframes ??
          (request.sourceTimeframeIds ?? []).map((timeframeId) => ({
            requestedTimeframeId: timeframeId,
            activeTimeframeId: timeframeId,
          }));
        const auxiliarySources = sourceMappings.map(
          ({ requestedTimeframeId, activeTimeframeId }) => {
            const lease = sources.get(activeTimeframeId);
            if (lease === undefined)
              throw new Error("Indicator auxiliary source was not acquired.");
            return {
              timeframeId: requestedTimeframeId,
              ...(activeTimeframeId === requestedTimeframeId
                ? {}
                : { activeTimeframeId }),
              candles: lease.snapshot().candles,
            };
          },
        );
        result = await execute(
          {
            kind: "rebuild",
            candles: base.snapshot().candles,
          },
          auxiliarySources,
        );
      } else {
        try {
          result = await execute(request.data);
        } catch (error) {
          if (
            !(error instanceof IndicatorWorkerRuntimeError) ||
            error.code !== "INDICATOR_WORKER_SNAPSHOT_REQUIRED"
          ) {
            throw error;
          }
          result = await execute({
            kind: "rebuild",
            candles: request.rebuildCandles(),
          });
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
      const sources = sourceLeases.get(instanceId);
      sourceLeases.delete(instanceId);
      if (sources !== undefined)
        for (const source of sources.values())
          void source.release().catch(() => undefined);
    },
    dispose: (): void => {
      supervisor.dispose();
      sourceLeases.clear();
      void sourceEngine?.dispose().catch(() => undefined);
    },
  };
}
