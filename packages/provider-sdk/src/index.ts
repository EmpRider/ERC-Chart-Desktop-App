import {
  providerContractVersion,
  type Candle,
  type CompatibilityRange,
  type ContractVersion,
  type InstrumentId,
  type ProviderId,
  type Tick,
  type TimeframeId,
} from "@erc-chart/contracts";

export { providerContractVersion } from "@erc-chart/contracts";

export const providerSdkVersion: ContractVersion = providerContractVersion;

export interface ProviderPluginMetadata {
  readonly id: ProviderId;
  readonly name: string;
  readonly providerContractVersion: ContractVersion;
  readonly hostCompatibility: CompatibilityRange;
}

export interface ProviderCapabilities {
  readonly instruments: boolean;
  readonly nativeTimeframes: readonly TimeframeId[];
  readonly liveData: boolean;
  readonly derivedTimeframes: boolean;
}

export interface ProviderHistoryRequest {
  readonly instrumentId: InstrumentId;
  readonly timeframeId: TimeframeId;
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
}

export interface ProviderSubscriptionRequest {
  readonly instrumentId: InstrumentId;
  readonly timeframeId: TimeframeId;
}

export interface ProviderDataSink {
  readonly onCandles: (candles: readonly Candle[]) => void;
  readonly onTicks: (ticks: readonly Tick[]) => void;
  readonly onError: (code: string) => void;
}

export interface ProviderSubscription {
  readonly unsubscribe: () => Promise<void>;
}

export interface ProviderAdapter {
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly getCapabilities: () => Promise<ProviderCapabilities>;
  readonly requestHistory: (
    request: ProviderHistoryRequest,
  ) => Promise<readonly Candle[]>;
  readonly subscribe: (
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ) => Promise<ProviderSubscription>;
}
