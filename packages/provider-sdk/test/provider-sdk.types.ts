import {
  config,
  defineProvider,
  hostApiVersion,
  providerSdkVersion,
  type Candle,
  type InstrumentId,
  type ProviderAdapter,
  type ProviderDefinition,
  type ProviderHostServices,
  type ProviderId,
  type ProviderPluginMetadata,
  type TimeframeId,
} from "../src/index.js";

const providerId = "fixture.provider" as ProviderId;
const instrumentId = "fixture-instrument" as InstrumentId;
const timeframeId = "fixture-timeframe" as TimeframeId;

export const metadata: ProviderPluginMetadata = {
  id: providerId,
  name: "Fixture Provider",
  providerContractVersion: providerSdkVersion,
  hostCompatibility: {
    minimumHostApiVersion: hostApiVersion,
    maximumHostApiVersion: hostApiVersion,
  },
};

export const adapter: ProviderAdapter = {
  connect: async () => undefined,
  disconnect: async () => undefined,
  getCapabilities: async () => ({
    instruments: true,
    nativeTimeframes: [timeframeId],
    liveData: true,
    derivedTimeframes: false,
  }),
  getInstruments: async () => [
    { id: instrumentId, symbol: "FIX", name: "Fixture Instrument" },
  ],
  requestHistory: async (): Promise<readonly Candle[]> => [],
  subscribe: async () => ({ unsubscribe: async () => undefined }),
};

export const definition: ProviderDefinition = defineProvider({
  metadata,
  version: "1.0.0",
  config: {
    endpoint: config.string({
      defaultValue: "https://example.invalid",
      requiresReconnect: true,
    }),
    token: config.secret("token", { required: true }),
  },
  create: async (host: ProviderHostServices) => {
    void host;
    return adapter;
  },
});
