import {
  contractVersion,
  hostApiVersion,
  providerContractVersion,
  type Candle,
  type InstrumentId,
  type ProviderId,
  type Tick,
  type TimeframeId,
} from "@erc-chart/contracts";
import {
  providerSdkVersion,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderDataSink,
  type ProviderHistoryRequest,
  type ProviderPluginMetadata,
  type ProviderSubscriptionRequest,
} from "@erc-chart/provider-sdk";

export type ProviderContractViolationCode =
  | "INCOMPATIBLE_HOST_API"
  | "MALFORMED_PROVIDER_VALUE"
  | "PROVIDER_OPERATION_FAILED"
  | "STALE_PROVIDER_GENERATION"
  | "UNSUPPORTED_PROVIDER_CONTRACT";

export interface ProviderContractViolation {
  readonly code: ProviderContractViolationCode;
  readonly path: string;
  readonly message: string;
}

export interface ProviderContractReport {
  readonly ok: boolean;
  readonly violations: readonly ProviderContractViolation[];
}

export interface ProviderContractSubject {
  readonly metadata: ProviderPluginMetadata;
  readonly adapter: ProviderAdapter;
  readonly historyRequest: ProviderHistoryRequest;
  readonly subscriptionRequest: ProviderSubscriptionRequest;
}

export type ProviderFixtureCall =
  | "connect"
  | "disconnect"
  | "getCapabilities"
  | "requestHistory"
  | "subscribe"
  | "unsubscribe";

export interface ProviderContractFixture extends ProviderContractSubject {
  readonly calls: readonly ProviderFixtureCall[];
  readonly candles: readonly Candle[];
  readonly ticks: readonly Tick[];
}

export interface ProviderContractFixtureOptions {
  readonly capabilities?: ProviderCapabilities;
  readonly candles?: readonly Candle[];
  readonly metadata?: ProviderPluginMetadata;
  readonly ticks?: readonly Tick[];
}

export interface ProviderHistoryEnvelopePayload {
  readonly kind: "history";
  readonly candles: readonly Candle[];
}

export type ProviderContractCaseName =
  "current" | "malformed" | "stale-generation" | "unknown-version";

export interface ProviderContractCase {
  readonly name: ProviderContractCaseName;
  readonly value: unknown;
  readonly expectedAccepted: boolean;
  readonly expectedViolation?: ProviderContractViolationCode;
}

const fixtureProviderId = "fixture-provider" as ProviderId;
const fixtureInstrumentId = "fixture-instrument" as InstrumentId;
const fixtureTimeframeId = "fixture-timeframe" as TimeframeId;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  code: ProviderContractViolationCode,
  path: string,
  message: string,
): ProviderContractViolation {
  return { code, path, message };
}

function report(
  violations: readonly ProviderContractViolation[],
): ProviderContractReport {
  return { ok: violations.length === 0, violations };
}

function inspectMetadata(
  metadata: unknown,
): readonly ProviderContractViolation[] {
  if (!isRecord(metadata)) {
    return [
      failure(
        "MALFORMED_PROVIDER_VALUE",
        "metadata",
        "Provider metadata must be an object.",
      ),
    ];
  }
  const violations: ProviderContractViolation[] = [];
  if (
    typeof metadata.id !== "string" ||
    metadata.id.trim().length === 0 ||
    typeof metadata.name !== "string" ||
    metadata.name.trim().length === 0
  ) {
    violations.push(
      failure(
        "MALFORMED_PROVIDER_VALUE",
        "metadata",
        "Provider metadata requires non-empty id and name values.",
      ),
    );
  }
  if (metadata.providerContractVersion !== providerContractVersion) {
    violations.push(
      failure(
        "UNSUPPORTED_PROVIDER_CONTRACT",
        "metadata.providerContractVersion",
        `Expected provider contract ${providerContractVersion}.`,
      ),
    );
  }
  if (!isRecord(metadata.hostCompatibility)) {
    violations.push(
      failure(
        "INCOMPATIBLE_HOST_API",
        "metadata.hostCompatibility",
        `Provider must include host API ${hostApiVersion} in its compatibility range.`,
      ),
    );
    return violations;
  }
  const { minimumHostApiVersion, maximumHostApiVersion } =
    metadata.hostCompatibility;
  if (
    typeof minimumHostApiVersion !== "number" ||
    typeof maximumHostApiVersion !== "number" ||
    !Number.isSafeInteger(minimumHostApiVersion) ||
    !Number.isSafeInteger(maximumHostApiVersion) ||
    minimumHostApiVersion > hostApiVersion ||
    maximumHostApiVersion < hostApiVersion ||
    minimumHostApiVersion > maximumHostApiVersion
  ) {
    violations.push(
      failure(
        "INCOMPATIBLE_HOST_API",
        "metadata.hostCompatibility",
        `Provider must include host API ${hostApiVersion} in its compatibility range.`,
      ),
    );
  }
  return violations;
}

function inspectCapabilities(
  capabilities: unknown,
): readonly ProviderContractViolation[] {
  if (!isRecord(capabilities)) {
    return [
      failure(
        "MALFORMED_PROVIDER_VALUE",
        "capabilities",
        "Provider capabilities must be an object.",
      ),
    ];
  }
  const violations: ProviderContractViolation[] = [];
  if (
    typeof capabilities.instruments !== "boolean" ||
    typeof capabilities.liveData !== "boolean" ||
    typeof capabilities.derivedTimeframes !== "boolean" ||
    !Array.isArray(capabilities.nativeTimeframes) ||
    capabilities.nativeTimeframes.some(
      (timeframe) =>
        typeof timeframe !== "string" || timeframe.trim().length === 0,
    )
  ) {
    violations.push(
      failure(
        "MALFORMED_PROVIDER_VALUE",
        "capabilities",
        "Provider capabilities must use booleans and non-empty timeframe identifiers.",
      ),
    );
  }
  return violations;
}

function inspectCandle(
  value: unknown,
  path: string,
  expectedInstrumentId?: InstrumentId,
  expectedTimeframeId?: TimeframeId,
): readonly ProviderContractViolation[] {
  if (!isRecord(value)) {
    return [
      failure(
        "MALFORMED_PROVIDER_VALUE",
        path,
        "A provider candle must be an object.",
      ),
    ];
  }
  const violations: ProviderContractViolation[] = [];
  if (
    typeof value.instrumentId !== "string" ||
    value.instrumentId.length === 0 ||
    typeof value.timeframeId !== "string" ||
    value.timeframeId.length === 0
  ) {
    violations.push(
      failure(
        "MALFORMED_PROVIDER_VALUE",
        path,
        "A provider candle requires instrument and timeframe identifiers.",
      ),
    );
  }
  if (
    expectedInstrumentId !== undefined &&
    value.instrumentId !== expectedInstrumentId
  ) {
    violations.push(
      failure(
        "MALFORMED_PROVIDER_VALUE",
        `${path}.instrumentId`,
        "History returned a candle for a different instrument.",
      ),
    );
  }
  if (
    expectedTimeframeId !== undefined &&
    value.timeframeId !== expectedTimeframeId
  ) {
    violations.push(
      failure(
        "MALFORMED_PROVIDER_VALUE",
        `${path}.timeframeId`,
        "History returned a candle for a different timeframe.",
      ),
    );
  }
  const prices = [value.open, value.high, value.low, value.close];
  if (
    typeof value.openTimeMs !== "number" ||
    !Number.isSafeInteger(value.openTimeMs) ||
    value.openTimeMs < 0 ||
    prices.some((price) => typeof price !== "number" || !Number.isFinite(price))
  ) {
    violations.push(
      failure(
        "MALFORMED_PROVIDER_VALUE",
        path,
        "Candle time and OHLC values must be finite and valid.",
      ),
    );
  } else {
    const [open, high, low, close] = prices as [number, number, number, number];
    if (
      high < Math.max(open, low, close) ||
      low > Math.min(open, high, close)
    ) {
      violations.push(
        failure(
          "MALFORMED_PROVIDER_VALUE",
          path,
          "Candle OHLC values violate high/low invariants.",
        ),
      );
    }
  }
  if (
    value.volume !== undefined &&
    (typeof value.volume !== "number" ||
      !Number.isFinite(value.volume) ||
      value.volume < 0)
  ) {
    violations.push(
      failure(
        "MALFORMED_PROVIDER_VALUE",
        `${path}.volume`,
        "Candle volume must be a finite non-negative number.",
      ),
    );
  }
  return violations;
}

function inspectTick(
  value: unknown,
  path: string,
  expectedInstrumentId: InstrumentId,
): readonly ProviderContractViolation[] {
  if (!isRecord(value)) {
    return [
      failure(
        "MALFORMED_PROVIDER_VALUE",
        path,
        "A provider tick must be an object.",
      ),
    ];
  }
  const violations: ProviderContractViolation[] = [];
  if (
    value.instrumentId !== expectedInstrumentId ||
    typeof value.timestampMs !== "number" ||
    !Number.isSafeInteger(value.timestampMs) ||
    value.timestampMs < 0 ||
    typeof value.price !== "number" ||
    !Number.isFinite(value.price)
  ) {
    violations.push(
      failure(
        "MALFORMED_PROVIDER_VALUE",
        path,
        "Provider ticks must match the subscription and use finite time and price values.",
      ),
    );
  }
  if (
    value.volume !== undefined &&
    (typeof value.volume !== "number" ||
      !Number.isFinite(value.volume) ||
      value.volume < 0)
  ) {
    violations.push(
      failure(
        "MALFORMED_PROVIDER_VALUE",
        `${path}.volume`,
        "Tick volume must be a finite non-negative number.",
      ),
    );
  }
  return violations;
}

export function createProviderContractFixture(
  options: ProviderContractFixtureOptions = {},
): ProviderContractFixture {
  const calls: ProviderFixtureCall[] = [];
  const candles: readonly Candle[] =
    options.candles !== undefined
      ? options.candles
      : [
          {
            instrumentId: fixtureInstrumentId,
            timeframeId: fixtureTimeframeId,
            openTimeMs: 1_800_000_000_000,
            open: 100,
            high: 102,
            low: 99,
            close: 101,
            volume: 25,
          },
        ];
  const ticks: readonly Tick[] =
    options.ticks !== undefined
      ? options.ticks
      : [
          {
            instrumentId: fixtureInstrumentId,
            timestampMs: 1_800_000_030_000,
            price: 101.5,
            volume: 2,
          },
        ];
  const capabilities: ProviderCapabilities =
    options.capabilities !== undefined
      ? options.capabilities
      : {
          instruments: true,
          nativeTimeframes: [fixtureTimeframeId],
          liveData: true,
          derivedTimeframes: false,
        };
  const metadata: ProviderPluginMetadata =
    options.metadata !== undefined
      ? options.metadata
      : {
          id: fixtureProviderId,
          name: "Fixture Provider",
          providerContractVersion: providerSdkVersion,
          hostCompatibility: {
            minimumHostApiVersion: hostApiVersion,
            maximumHostApiVersion: hostApiVersion,
          },
        };
  const adapter: ProviderAdapter = {
    connect: async (): Promise<void> => {
      calls.push("connect");
    },
    disconnect: async (): Promise<void> => {
      calls.push("disconnect");
    },
    getCapabilities: async (): Promise<ProviderCapabilities> => {
      calls.push("getCapabilities");
      return capabilities;
    },
    requestHistory: async (): Promise<readonly Candle[]> => {
      calls.push("requestHistory");
      return candles;
    },
    subscribe: async (
      _request: ProviderSubscriptionRequest,
      sink: ProviderDataSink,
    ) => {
      calls.push("subscribe");
      sink.onTicks(ticks);
      return {
        unsubscribe: async (): Promise<void> => {
          calls.push("unsubscribe");
        },
      };
    },
  };
  return {
    metadata,
    adapter,
    historyRequest: {
      instrumentId: fixtureInstrumentId,
      timeframeId: fixtureTimeframeId,
      limit: 100,
    },
    subscriptionRequest: {
      instrumentId: fixtureInstrumentId,
      timeframeId: fixtureTimeframeId,
    },
    calls,
    candles,
    ticks,
  };
}

function operationFailure(path: string): ProviderContractViolation {
  return failure(
    "PROVIDER_OPERATION_FAILED",
    path,
    "Provider adapter operation failed during conformance.",
  );
}

type CapturedOperation<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false };

async function captureOperation<T>(
  path: string,
  operation: () => Promise<T>,
  violations: ProviderContractViolation[],
): Promise<CapturedOperation<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch {
    violations.push(operationFailure(path));
    return { ok: false };
  }
}

function inspectCandleBatch(
  value: unknown,
  path: string,
  expectedInstrumentId: InstrumentId,
  expectedTimeframeId: TimeframeId,
): readonly ProviderContractViolation[] {
  if (!Array.isArray(value)) {
    return [
      failure(
        "MALFORMED_PROVIDER_VALUE",
        path,
        "Provider candles must be an array.",
      ),
    ];
  }
  return value.flatMap((candle, index) =>
    inspectCandle(
      candle,
      `${path}[${index}]`,
      expectedInstrumentId,
      expectedTimeframeId,
    ),
  );
}

function inspectTickBatch(
  value: unknown,
  path: string,
  expectedInstrumentId: InstrumentId,
): readonly ProviderContractViolation[] {
  if (!Array.isArray(value)) {
    return [
      failure(
        "MALFORMED_PROVIDER_VALUE",
        path,
        "Provider ticks must be an array.",
      ),
    ];
  }
  return value.flatMap((tick, index) =>
    inspectTick(tick, `${path}[${index}]`, expectedInstrumentId),
  );
}

export async function runProviderContractConformance(
  subject: ProviderContractSubject,
): Promise<ProviderContractReport> {
  const violations = [...inspectMetadata(subject.metadata)];
  if (violations.length > 0) return report(violations);

  const connectResult = await captureOperation(
    "adapter.connect",
    async () => {
      await subject.adapter.connect();
      return true;
    },
    violations,
  );
  if (!connectResult.ok) return report(violations);

  try {
    const capabilities = await captureOperation(
      "adapter.getCapabilities",
      () => subject.adapter.getCapabilities(),
      violations,
    );
    if (capabilities.ok) {
      violations.push(...inspectCapabilities(capabilities.value));
    }

    const candles = await captureOperation(
      "adapter.requestHistory",
      () => subject.adapter.requestHistory(subject.historyRequest),
      violations,
    );
    if (candles.ok) {
      violations.push(
        ...inspectCandleBatch(
          candles.value,
          "history",
          subject.historyRequest.instrumentId,
          subject.historyRequest.timeframeId,
        ),
      );
    }

    const sink: ProviderDataSink = {
      onCandles: (batch: readonly Candle[]): void => {
        violations.push(
          ...inspectCandleBatch(
            batch,
            "subscription.candles",
            subject.subscriptionRequest.instrumentId,
            subject.subscriptionRequest.timeframeId,
          ),
        );
      },
      onTicks: (batch: readonly Tick[]): void => {
        violations.push(
          ...inspectTickBatch(
            batch,
            "subscription.ticks",
            subject.subscriptionRequest.instrumentId,
          ),
        );
      },
      onError: (code: string): void => {
        if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) {
          violations.push(
            failure(
              "MALFORMED_PROVIDER_VALUE",
              "subscription.error",
              "Provider error codes must use stable uppercase identifiers.",
            ),
          );
        }
      },
    };
    const subscription = await captureOperation(
      "adapter.subscribe",
      () => subject.adapter.subscribe(subject.subscriptionRequest, sink),
      violations,
    );
    if (subscription.ok) {
      if (!isRecord(subscription.value)) {
        violations.push(
          failure(
            "MALFORMED_PROVIDER_VALUE",
            "subscription",
            "Provider subscription must expose an unsubscribe operation.",
          ),
        );
      } else if (typeof subscription.value.unsubscribe !== "function") {
        violations.push(
          failure(
            "MALFORMED_PROVIDER_VALUE",
            "subscription.unsubscribe",
            "Provider subscription must expose an unsubscribe operation.",
          ),
        );
      } else {
        await captureOperation(
          "adapter.unsubscribe",
          () => subscription.value.unsubscribe(),
          violations,
        );
      }
    }
  } finally {
    await captureOperation(
      "adapter.disconnect",
      () => subject.adapter.disconnect(),
      violations,
    );
  }
  return report(violations);
}

export function inspectProviderHistoryEnvelope(
  value: unknown,
  expectedGeneration: number,
): ProviderContractReport {
  if (!isRecord(value)) {
    return report([
      failure(
        "MALFORMED_PROVIDER_VALUE",
        "envelope",
        "Provider history envelope must be an object.",
      ),
    ]);
  }
  if (
    typeof value.contractVersion !== "number" ||
    !Number.isSafeInteger(value.contractVersion) ||
    value.contractVersion < 1
  ) {
    return report([
      failure(
        "MALFORMED_PROVIDER_VALUE",
        "envelope.contractVersion",
        "Provider contract version must be a positive safe integer.",
      ),
    ]);
  }
  if (value.contractVersion !== providerContractVersion) {
    return report([
      failure(
        "UNSUPPORTED_PROVIDER_CONTRACT",
        "envelope.contractVersion",
        `Expected provider contract ${providerContractVersion}.`,
      ),
    ]);
  }
  if (
    typeof value.generation !== "number" ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 0
  ) {
    return report([
      failure(
        "MALFORMED_PROVIDER_VALUE",
        "envelope.generation",
        "Provider generation must be a non-negative safe integer.",
      ),
    ]);
  }
  if (value.generation !== expectedGeneration) {
    return report([
      failure(
        "STALE_PROVIDER_GENERATION",
        "envelope.generation",
        `Expected provider generation ${expectedGeneration}.`,
      ),
    ]);
  }
  const violations: ProviderContractViolation[] = [];
  if (
    typeof value.requestId !== "string" ||
    value.requestId.trim().length === 0 ||
    typeof value.revision !== "number" ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !isRecord(value.payload) ||
    value.payload.kind !== "history" ||
    !Array.isArray(value.payload.candles)
  ) {
    violations.push(
      failure(
        "MALFORMED_PROVIDER_VALUE",
        "envelope",
        "Provider history envelope fields are malformed.",
      ),
    );
    return report(violations);
  }
  for (const [index, candle] of value.payload.candles.entries()) {
    violations.push(
      ...inspectCandle(candle, `envelope.payload.candles[${index}]`),
    );
  }
  return report(violations);
}

export function createProviderEnvelopeCases(
  expectedGeneration = 7,
): readonly ProviderContractCase[] {
  const fixture = createProviderContractFixture();
  const current = {
    contractVersion: providerContractVersion,
    requestId: "provider-history-1",
    generation: expectedGeneration,
    revision: 1,
    payload: { kind: "history", candles: fixture.candles },
  };
  return [
    {
      name: "current",
      value: current,
      expectedAccepted: true,
    },
    {
      name: "malformed",
      value: {
        ...current,
        payload: {
          kind: "history",
          candles: fixture.candles.map((candle, index) =>
            index === 0 ? { ...candle, high: 98 } : candle,
          ),
        },
      },
      expectedAccepted: false,
      expectedViolation: "MALFORMED_PROVIDER_VALUE",
    },
    {
      name: "unknown-version",
      value: {
        ...current,
        contractVersion: contractVersion(providerContractVersion + 1),
      },
      expectedAccepted: false,
      expectedViolation: "UNSUPPORTED_PROVIDER_CONTRACT",
    },
    {
      name: "stale-generation",
      value: { ...current, generation: expectedGeneration - 1 },
      expectedAccepted: false,
      expectedViolation: "STALE_PROVIDER_GENERATION",
    },
  ];
}
