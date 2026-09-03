import {
  defineProvider,
  hostApiVersion,
  providerSdkVersion,
  type Candle,
  type InstrumentId,
  type ProviderAdapter,
  type ProviderDefinition,
  type ProviderId,
  type Tick,
  type TimeframeId,
} from "@erc-chart/provider-sdk";

const providerId = "example.tick-provider" as ProviderId;
const instrumentId = "EXAMPLE-TICK" as InstrumentId;
const timeframeId = "1m" as TimeframeId;

const history: readonly Candle[] = Object.freeze([
  Object.freeze({
    instrumentId,
    timeframeId,
    openTimeMs: 1_800_000_000_000,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 24,
  }),
]);

const liveTicks: readonly Tick[] = Object.freeze([
  Object.freeze({
    instrumentId,
    timestampMs: 1_800_000_030_000,
    price: 101.5,
    volume: 2,
  }),
]);

const adapter: ProviderAdapter = {
  connect: async () => undefined,
  disconnect: async () => undefined,
  getCapabilities: async () => ({
    instruments: true,
    nativeTimeframes: [timeframeId],
    liveData: true,
    derivedTimeframes: false,
  }),
  getInstruments: async () => [
    { id: instrumentId, symbol: "EXT", name: "Example Tick Instrument" },
  ],
  requestHistory: async (request) =>
    request.instrumentId === instrumentId && request.timeframeId === timeframeId
      ? history
      : [],
  subscribe: async (request, sink) => {
    if (
      request.instrumentId === instrumentId &&
      request.timeframeId === timeframeId
    ) {
      sink.onTicks(liveTicks);
    }
    return { unsubscribe: async () => undefined };
  },
};

const provider: ProviderDefinition = defineProvider({
  metadata: {
    id: providerId,
    name: "Example Tick Provider",
    providerContractVersion: providerSdkVersion,
    hostCompatibility: {
      minimumHostApiVersion: hostApiVersion,
      maximumHostApiVersion: hostApiVersion,
    },
  },
  version: "1.0.0",
  create: async () => adapter,
});

export default provider;
