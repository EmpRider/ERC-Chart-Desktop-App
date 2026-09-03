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
export { hostApiVersion } from "@erc-chart/contracts";
export type {
  Candle,
  CompatibilityRange,
  ContractVersion,
  InstrumentId,
  ProviderId,
  Tick,
  TimeframeId,
} from "@erc-chart/contracts";

export const providerSdkVersion: ContractVersion = providerContractVersion;

export type ProviderConfigurationValue = boolean | number | string;

interface ProviderConfigurationFieldBase {
  readonly label?: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly requiresReconnect?: boolean;
}

export interface ProviderBooleanConfigurationField extends ProviderConfigurationFieldBase {
  readonly type: "boolean";
  readonly defaultValue?: boolean;
}

export interface ProviderNumberConfigurationField extends ProviderConfigurationFieldBase {
  readonly type: "number";
  readonly defaultValue?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly step?: number;
}

export interface ProviderStringConfigurationField extends ProviderConfigurationFieldBase {
  readonly type: "string";
  readonly defaultValue?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
}

export interface ProviderSecretConfigurationField extends ProviderConfigurationFieldBase {
  readonly type: "secret";
  readonly credentialKey: string;
}

export type ProviderConfigurationField =
  | ProviderBooleanConfigurationField
  | ProviderNumberConfigurationField
  | ProviderStringConfigurationField
  | ProviderSecretConfigurationField;

export type ProviderConfigurationSchema = Readonly<
  Record<string, ProviderConfigurationField>
>;

export type ProviderConfiguration = Readonly<
  Record<string, ProviderConfigurationValue>
>;

function freezeField<T extends ProviderConfigurationField>(
  field: T,
): Readonly<T> {
  return Object.freeze({ ...field }) as Readonly<T>;
}

export interface ProviderConfigurationHelpers {
  readonly boolean: (
    options?: Omit<ProviderBooleanConfigurationField, "type">,
  ) => Readonly<ProviderBooleanConfigurationField>;
  readonly number: (
    options?: Omit<ProviderNumberConfigurationField, "type">,
  ) => Readonly<ProviderNumberConfigurationField>;
  readonly string: (
    options?: Omit<ProviderStringConfigurationField, "type">,
  ) => Readonly<ProviderStringConfigurationField>;
  readonly secret: (
    credentialKey: string,
    options?: Omit<ProviderSecretConfigurationField, "type" | "credentialKey">,
  ) => Readonly<ProviderSecretConfigurationField>;
}
export const config: ProviderConfigurationHelpers = Object.freeze({
  boolean: (options: Omit<ProviderBooleanConfigurationField, "type"> = {}) =>
    freezeField({ type: "boolean", ...options }),
  number: (options: Omit<ProviderNumberConfigurationField, "type"> = {}) =>
    freezeField({ type: "number", ...options }),
  string: (options: Omit<ProviderStringConfigurationField, "type"> = {}) =>
    freezeField({ type: "string", ...options }),
  secret: (
    credentialKey: string,
    options: Omit<
      ProviderSecretConfigurationField,
      "type" | "credentialKey"
    > = {},
  ) => freezeField({ type: "secret", credentialKey, ...options }),
});

export interface ProviderPluginMetadata {
  readonly id: ProviderId;
  readonly name: string;
  readonly providerContractVersion: ContractVersion;
  readonly hostCompatibility: CompatibilityRange;
}

export interface ProviderInstrument {
  readonly id: InstrumentId;
  readonly symbol: string;
  readonly name: string;
}

export interface ProviderCapabilities {
  readonly instruments: boolean;
  readonly nativeTimeframes: readonly TimeframeId[];
  readonly liveData: boolean;
  readonly derivedTimeframes: boolean;
}

export type ProviderStatus =
  "disconnected" | "connecting" | "connected" | "degraded" | "reconnecting";

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

export interface ProviderNetworkResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface ProviderNetworkRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Uint8Array | string;
  readonly timeoutMs?: number;
}

export interface ProviderNetworkBroker {
  readonly request: (
    request: ProviderNetworkRequest,
  ) => Promise<ProviderNetworkResponse>;
}

export interface ProviderCredentialLease {
  readonly get: (credentialKey: string) => Promise<string | null>;
}

export interface ProviderLogger {
  readonly debug: (
    code: string,
    metadata?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly info: (
    code: string,
    metadata?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly warn: (
    code: string,
    metadata?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly error: (
    code: string,
    metadata?: Readonly<Record<string, unknown>>,
  ) => void;
}

export interface ProviderHostServices {
  readonly network: ProviderNetworkBroker;
  readonly credentials: ProviderCredentialLease;
  readonly logger: ProviderLogger;
  readonly now: () => number;
  readonly reportStatus: (status: ProviderStatus) => void;
}

export interface ProviderAdapter {
  readonly connect: () => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly getCapabilities: () => Promise<ProviderCapabilities>;
  readonly getInstruments: () => Promise<readonly ProviderInstrument[]>;
  readonly requestHistory: (
    request: ProviderHistoryRequest,
  ) => Promise<readonly Candle[]>;
  readonly subscribe: (
    request: ProviderSubscriptionRequest,
    sink: ProviderDataSink,
  ) => Promise<ProviderSubscription>;
}

export interface ProviderDefinition {
  readonly metadata: ProviderPluginMetadata;
  readonly version: string;
  readonly config?: ProviderConfigurationSchema;
  readonly create: (
    host: ProviderHostServices,
    settings: ProviderConfiguration,
  ) => ProviderAdapter | Promise<ProviderAdapter>;
}

export function defineProvider(
  definition: ProviderDefinition,
): ProviderDefinition {
  return Object.freeze({
    ...definition,
    metadata: Object.freeze({
      ...definition.metadata,
      hostCompatibility: Object.freeze({
        ...definition.metadata.hostCompatibility,
      }),
    }),
    config: Object.freeze({ ...(definition.config ?? {}) }),
  });
}
