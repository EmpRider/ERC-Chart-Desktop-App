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
  const sourceLeases = new Map<
    string,
    { readonly identity: string; readonly lease: IndicatorSourceLease }
  >();

  const sourceFor = async (
    request: BrowserIndicatorSyncRequest,
  ): Promise<IndicatorSourceLease | undefined> => {
    if (
      sourceEngine === undefined ||
      request.providerProfileId === undefined ||
      request.providerProfileId.length === 0
    ) {
      return undefined;
    }
    const key = {
      providerProfileId: request.providerProfileId,
      instrumentId: request.instrumentId,
      timeframeId: request.timeframeId,
      candleType: "standard" as const,
    };
    const identity = JSON.stringify([
      key.providerProfileId,
      key.instrumentId,
      key.timeframeId,
      key.candleType,
    ]);
    const current = sourceLeases.get(request.instanceId);
    if (current?.identity === identity) return current.lease;
    const lease = await sourceEngine.acquire(key);
    sourceLeases.set(request.instanceId, { identity, lease });
    await current?.lease.release();
    return lease;
  };

  return {
    sync: async (request): Promise<IndicatorWorkerResultUpdate> => {
      const execute = (data: IndicatorWorkerDataUpdate) =>
        supervisor.sync({
          instanceId: request.instanceId,
          runtimeEntryUrl: request.runtimeEntryUrl,
          pluginId: request.pluginId,
          definitionId: request.definitionId,
          instrumentId: request.instrumentId,
          timeframeId: request.timeframeId,
          parameters: request.parameters,
          data,
          dataRevision: request.dataRevision,
          configGeneration: request.configGeneration,
        });
      const source = await sourceFor(request);
      let result;
      if (source !== undefined) {
        result = await execute({
          kind: "rebuild",
          candles: source.snapshot().candles,
        });
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
      const source = sourceLeases.get(instanceId);
      sourceLeases.delete(instanceId);
      void source?.lease.release().catch(() => undefined);
    },
    dispose: (): void => {
      supervisor.dispose();
      sourceLeases.clear();
      void sourceEngine?.dispose().catch(() => undefined);
    },
  };
}
