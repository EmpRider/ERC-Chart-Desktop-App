import {
  defineProvider,
  hostApiVersion,
  providerSdkVersion,
  type Candle,
  type InstrumentId,
  type ProviderAdapter,
  type ProviderDefinition,
  type ProviderId,
  type TimeframeId,
} from "@erc-chart/provider-sdk";

const providerId = "example.candle-provider" as ProviderId;
const instrumentId = "EXAMPLE-CANDLE" as InstrumentId;
const timeframeId = "1m" as TimeframeId;

const candles: readonly Candle[] = Object.freeze([
  Object.freeze({
    instrumentId,
    timeframeId,
    openTimeMs: 1_800_000_000_000,
    open: 200,
    high: 204,
    low: 198,
    close: 203,
    volume: 32,
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
    {
      id: instrumentId,
      symbol: "EXC",
      name: "Example Candle Instrument",
    },
  ],
  requestHistory: async (request) =>
    request.instrumentId === instrumentId && request.timeframeId === timeframeId
      ? candles
      : [],
  subscribe: async (request, sink) => {
    if (
      request.instrumentId === instrumentId &&
      request.timeframeId === timeframeId
    ) {
      sink.onCandles(candles);
    }
    return { unsubscribe: async () => undefined };
  },
};

const provider: ProviderDefinition = defineProvider({
  metadata: {
    id: providerId,
    name: "Example Candle Provider",
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
