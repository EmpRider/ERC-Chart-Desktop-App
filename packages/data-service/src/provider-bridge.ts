import type { Candle } from "@erc-chart/contracts";
import type {
  ProviderCapabilities,
  ProviderDataSink,
  ProviderHistoryRequest,
  ProviderInstrument,
  ProviderSubscription,
  ProviderSubscriptionRequest,
} from "@erc-chart/provider-sdk";

export interface ProviderDataUpstream {
  readonly getCapabilities: (
    providerProfileId: string,
  ) => Promise<ProviderCapabilities>;
  readonly getInstruments: (
    providerProfileId: string,
  ) => Promise<readonly ProviderInstrument[]>;
  readonly requestHistory: (
    providerProfileId: string,
    request: ProviderHistoryRequest,
  ) => Promise<readonly Candle[]>;
  readonly subscribe: (
    providerProfileId: string,
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ) => Promise<ProviderSubscription>;
}

export interface ProviderDataService {
  readonly getCapabilities: ProviderDataUpstream["getCapabilities"];
  readonly getInstruments: ProviderDataUpstream["getInstruments"];
  readonly requestHistory: ProviderDataUpstream["requestHistory"];
  readonly subscribe: ProviderDataUpstream["subscribe"];
  readonly invalidateProfile: (providerProfileId: string) => Promise<void>;
  readonly restoreProfile: (providerProfileId: string) => Promise<void>;
  readonly shutdown: () => Promise<void>;
}

interface LogicalDemand {
  readonly providerProfileId: string;
  readonly request: ProviderSubscriptionRequest;
  readonly sinks: Map<number, ProviderDataSink>;
  generation: number;
  invalidated: boolean;
  upstreamSubscription: ProviderSubscription | undefined;
  connectPromise: Promise<void> | undefined;
}

function requireProviderProfileId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0
  ) {
    throw new RangeError("Provider profile ID is required.");
  }
  return value;
}

function demandKey(
  providerProfileId: string,
  request: ProviderSubscriptionRequest,
): string {
  return JSON.stringify([
    providerProfileId,
    request.instrumentId,
    request.timeframeId,
  ]);
}

function notify(
  demand: LogicalDemand,
  callback: (sink: ProviderDataSink) => void,
): void {
  for (const sink of [...demand.sinks.values()]) {
    try {
      callback(sink);
    } catch {
      // One logical consumer cannot block delivery to other consumers.
    }
  }
}

export function createProviderDataService(
  upstream: ProviderDataUpstream,
): ProviderDataService {
  const demands = new Map<string, LogicalDemand>();
  let consumerSequence = 0;

  const connectDemand = (demand: LogicalDemand): Promise<void> => {
    if (
      demand.invalidated ||
      demand.sinks.size === 0 ||
      demand.upstreamSubscription !== undefined
    ) {
      return Promise.resolve();
    }
    if (demand.connectPromise !== undefined) return demand.connectPromise;

    const generation = demand.generation;
    const connection = upstream
      .subscribe(demand.providerProfileId, demand.request, {
        onCandles: (candles): void => {
          if (demand.generation !== generation || demand.invalidated) return;
          notify(demand, (sink) => sink.onCandles(candles));
        },
        onTicks: (ticks): void => {
          if (demand.generation !== generation || demand.invalidated) return;
          notify(demand, (sink) => sink.onTicks(ticks));
        },
        onError: (code): void => {
          if (demand.generation !== generation || demand.invalidated) return;
          notify(demand, (sink) => sink.onError(code));
        },
      })
      .then(async (subscription) => {
        if (
          demand.generation !== generation ||
          demand.invalidated ||
          demand.sinks.size === 0
        ) {
          await subscription.unsubscribe();
          return;
        }
        demand.upstreamSubscription = subscription;
      })
      .finally(() => {
        if (demand.connectPromise === connection)
          demand.connectPromise = undefined;
      });
    demand.connectPromise = connection;
    return connection;
  };

  const releaseDemand = async (
    key: string,
    demand: LogicalDemand,
    consumerId: number,
  ): Promise<void> => {
    demand.sinks.delete(consumerId);
    if (demand.sinks.size !== 0) return;
    demands.delete(key);
    demand.generation += 1;
    await demand.connectPromise?.catch(() => undefined);
    const subscription = demand.upstreamSubscription;
    demand.upstreamSubscription = undefined;
    await subscription?.unsubscribe();
  };

  const subscribe = async (
    providerProfileIdValue: string,
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ): Promise<ProviderSubscription> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    const key = demandKey(providerProfileId, request);
    let demand = demands.get(key);
    if (demand === undefined) {
      demand = {
        providerProfileId,
        request: Object.freeze({ ...request }),
        sinks: new Map(),
        generation: 0,
        invalidated: false,
        upstreamSubscription: undefined,
        connectPromise: undefined,
      };
      demands.set(key, demand);
    }
    consumerSequence += 1;
    const consumerId = consumerSequence;
    demand.sinks.set(consumerId, sink);
    try {
      await connectDemand(demand);
    } catch (error) {
      demand.sinks.delete(consumerId);
      if (demand.sinks.size === 0) demands.delete(key);
      throw error;
    }

    let disposed = false;
    return {
      unsubscribe: async (): Promise<void> => {
        if (disposed) return;
        disposed = true;
        await releaseDemand(key, demand, consumerId);
      },
    };
  };

  const invalidateProfile = async (
    providerProfileIdValue: string,
  ): Promise<void> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    const matching = [...demands.values()].filter(
      (demand) => demand.providerProfileId === providerProfileId,
    );
    await Promise.all(
      matching.map(async (demand) => {
        demand.invalidated = true;
        demand.generation += 1;
        await demand.connectPromise?.catch(() => undefined);
        const subscription = demand.upstreamSubscription;
        demand.upstreamSubscription = undefined;
        await subscription?.unsubscribe();
      }),
    );
  };

  const restoreProfile = async (
    providerProfileIdValue: string,
  ): Promise<void> => {
    const providerProfileId = requireProviderProfileId(providerProfileIdValue);
    const matching = [...demands.values()].filter(
      (demand) => demand.providerProfileId === providerProfileId,
    );
    for (const demand of matching) demand.invalidated = false;
    try {
      await Promise.all(matching.map((demand) => connectDemand(demand)));
    } catch (error) {
      for (const demand of matching) {
        notify(demand, (sink) =>
          sink.onError("PROVIDER_SUBSCRIPTION_RESTORE_FAILED"),
        );
      }
      throw error;
    }
  };

  return {
    getCapabilities: (providerProfileId) =>
      upstream.getCapabilities(requireProviderProfileId(providerProfileId)),
    getInstruments: (providerProfileId) =>
      upstream.getInstruments(requireProviderProfileId(providerProfileId)),
    requestHistory: (providerProfileId, request) =>
      upstream.requestHistory(
        requireProviderProfileId(providerProfileId),
        request,
      ),
    subscribe,
    invalidateProfile,
    restoreProfile,
    shutdown: async (): Promise<void> => {
      const active = [...demands.values()];
      demands.clear();
      await Promise.all(
        active.map(async (demand) => {
          demand.invalidated = true;
          demand.generation += 1;
          await demand.connectPromise?.catch(() => undefined);
          const subscription = demand.upstreamSubscription;
          demand.upstreamSubscription = undefined;
          demand.sinks.clear();
          await subscription?.unsubscribe();
        }),
      );
    },
  };
}
