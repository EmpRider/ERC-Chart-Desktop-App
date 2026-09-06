import type { IndicatorRuntimeSyncRequest } from "@erc-chart/contracts";
import {
  createIndicatorWorkerSupervisor,
  IndicatorWorkerRuntimeError,
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
  readonly data: IndicatorWorkerDataUpdate;
  readonly rebuildCandles: () => readonly IndicatorRuntimeSyncRequest["candles"][number][];
  readonly dataRevision: number;
  readonly configGeneration: number;
}

export interface BrowserIndicatorRuntime {
  readonly sync: (
    request: BrowserIndicatorSyncRequest,
  ) => Promise<IndicatorWorkerResultUpdate>;
  readonly disposeInstance: (instanceId: string) => void;
  readonly dispose: () => void;
}

export function createBrowserIndicatorRuntime(
  options: IndicatorWorkerSupervisorOptions = {},
): BrowserIndicatorRuntime {
  const supervisor: IndicatorWorkerSupervisor =
    createIndicatorWorkerSupervisor(options);
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
      let result;
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
      if (
        result.instanceId !== request.instanceId ||
        result.dataRevision !== request.dataRevision ||
        result.configGeneration !== request.configGeneration
      ) {
        throw new Error("Indicator worker returned a stale result generation.");
      }
      return result.result;
    },
    disposeInstance: (instanceId): void =>
      supervisor.disposeInstance(instanceId),
    dispose: (): void => supervisor.dispose(),
  };
}
