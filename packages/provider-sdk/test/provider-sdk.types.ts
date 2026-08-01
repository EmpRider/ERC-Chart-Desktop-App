import type {
  Candle,
  InstrumentId,
  ProviderId,
  TimeframeId,
} from "@erc-chart/contracts";
import {
  providerSdkVersion,
  type ProviderAdapter,
  type ProviderPluginMetadata,
} from "../src/index.js";

const providerId = "fixture-provider" as ProviderId;
const instrumentId = "fixture-instrument" as InstrumentId;
const timeframeId = "fixture-timeframe" as TimeframeId;

export const metadata = {
  id: providerId,
  name: "Fixture Provider",
  providerContractVersion: providerSdkVersion,
  hostCompatibility: {
    minimumHostApiVersion: providerSdkVersion,
    maximumHostApiVersion: providerSdkVersion,
  },
} satisfies ProviderPluginMetadata;

export const adapter: ProviderAdapter = {
  connect: async () => undefined,
  disconnect: async () => undefined,
  getCapabilities: async () => ({
    instruments: true,
    nativeTimeframes: [timeframeId],
    liveData: true,
    derivedTimeframes: false,
  }),
  requestHistory: async (): Promise<readonly Candle[]> => [],
  subscribe: async () => ({
    unsubscribe: async () => undefined,
  }),
};

void instrumentId;
