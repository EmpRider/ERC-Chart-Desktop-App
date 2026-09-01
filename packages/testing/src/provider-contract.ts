import {
  hostApiVersion,
  providerContractVersion,
  type Candle,
  type InstrumentId,
  type ProviderId,
  type Tick,
  type TimeframeId,
} from "@erc-chart/contracts";
import {
  config,
  defineProvider,
  providerSdkVersion,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderConfiguration,
  type ProviderDataSink,
  type ProviderDefinition,
  type ProviderHistoryRequest,
  type ProviderHostServices,
  type ProviderInstrument,
  type ProviderSubscriptionRequest,
} from "@erc-chart/provider-sdk";

export type ProviderContractViolationCode =
  | "INCOMPATIBLE_HOST_API"
  | "MALFORMED_PROVIDER_VALUE"
  | "PROVIDER_OPERATION_FAILED"
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
  readonly definition: ProviderDefinition;
  readonly adapter: ProviderAdapter;
  readonly historyRequest: ProviderHistoryRequest;
  readonly subscriptionRequest: ProviderSubscriptionRequest;
}

export type ProviderFixtureCall =
  | "create"
  | "connect"
  | "disconnect"
  | "getCapabilities"
  | "getInstruments"
  | "requestHistory"
  | "subscribe"
  | "unsubscribe";

export interface ProviderContractFixture extends ProviderContractSubject {
  readonly calls: readonly ProviderFixtureCall[];
  readonly candles: readonly Candle[];
  readonly ticks: readonly Tick[];
  readonly instruments: readonly ProviderInstrument[];
}

export interface ProviderContractFixtureOptions {
  readonly capabilities?: ProviderCapabilities;
  readonly candles?: readonly Candle[];
  readonly instruments?: readonly ProviderInstrument[];
  readonly ticks?: readonly Tick[];
  readonly settings?: ProviderConfiguration;
}

const providerId = "fixture.provider" as ProviderId;
const instrumentId = "fixture-instrument" as InstrumentId;
const timeframeId = "fixture-timeframe" as TimeframeId;

function violation(
  code: ProviderContractViolationCode,
  path: string,
  message: string,
): ProviderContractViolation {
  return { code, path, message };
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inspectDefinition(definition: unknown): ProviderContractViolation[] {
  if (!record(definition)) {
    return [
      violation(
        "MALFORMED_PROVIDER_VALUE",
        "definition",
        "Provider definition must be an object.",
      ),
    ];
  }
  const result: ProviderContractViolation[] = [];
  const metadata = definition.metadata;
  if (
    !record(metadata) ||
    typeof metadata.id !== "string" ||
    !metadata.id ||
    typeof metadata.name !== "string" ||
    !metadata.name
  ) {
    result.push(
      violation(
        "MALFORMED_PROVIDER_VALUE",
        "definition.metadata",
        "Provider metadata requires non-empty id and name values.",
      ),
    );
    return result;
  }
  if (metadata.providerContractVersion !== providerContractVersion) {
    result.push(
      violation(
        "UNSUPPORTED_PROVIDER_CONTRACT",
        "definition.metadata.providerContractVersion",
        `Expected provider contract ${providerContractVersion}.`,
      ),
    );
  }
  const range = metadata.hostCompatibility;
  if (
    !record(range) ||
    typeof range.minimumHostApiVersion !== "number" ||
    typeof range.maximumHostApiVersion !== "number" ||
    range.minimumHostApiVersion > hostApiVersion ||
    range.maximumHostApiVersion < hostApiVersion
  ) {
    result.push(
      violation(
        "INCOMPATIBLE_HOST_API",
        "definition.metadata.hostCompatibility",
        `Provider must include host API ${hostApiVersion}.`,
      ),
    );
  }
  if (
    typeof definition.version !== "string" ||
    definition.version.length === 0 ||
    typeof definition.create !== "function"
  ) {
    result.push(
      violation(
        "MALFORMED_PROVIDER_VALUE",
        "definition",
        "Provider definition requires version and create().",
      ),
    );
  }
  if (definition.config !== undefined && !record(definition.config)) {
    result.push(
      violation(
        "MALFORMED_PROVIDER_VALUE",
        "definition.config",
        "Provider config declaration must be an object.",
      ),
    );
  }
  return result;
}

function inspectCapabilities(value: unknown): ProviderContractViolation[] {
  if (
    !record(value) ||
    typeof value.instruments !== "boolean" ||
    typeof value.liveData !== "boolean" ||
    typeof value.derivedTimeframes !== "boolean" ||
    !Array.isArray(value.nativeTimeframes) ||
    value.nativeTimeframes.some(
      (item) => typeof item !== "string" || item.length === 0,
    )
  ) {
    return [
      violation(
        "MALFORMED_PROVIDER_VALUE",
        "adapter.getCapabilities",
        "Capabilities must use booleans and valid timeframe identifiers.",
      ),
    ];
  }
  return [];
}

function inspectInstruments(value: unknown): ProviderContractViolation[] {
  if (!Array.isArray(value)) {
    return [
      violation(
        "MALFORMED_PROVIDER_VALUE",
        "adapter.getInstruments",
        "Instrument discovery must return an array.",
      ),
    ];
  }
  return value.flatMap((item, index) => {
    if (
      !record(item) ||
      typeof item.id !== "string" ||
      !item.id ||
      typeof item.symbol !== "string" ||
      !item.symbol ||
      typeof item.name !== "string" ||
      !item.name
    ) {
      return [
        violation(
          "MALFORMED_PROVIDER_VALUE",
          `adapter.getInstruments[${index}]`,
          "Instrument requires id, symbol, and name.",
        ),
      ];
    }
    return [];
  });
}

function inspectCandles(
  value: unknown,
  request: ProviderHistoryRequest,
): ProviderContractViolation[] {
  if (!Array.isArray(value)) {
    return [
      violation(
        "MALFORMED_PROVIDER_VALUE",
        "adapter.requestHistory",
        "History must return an array.",
      ),
    ];
  }
  return value.flatMap((item, index) => {
    const path = `adapter.requestHistory[${index}]`;
    if (!record(item)) {
      return [
        violation(
          "MALFORMED_PROVIDER_VALUE",
          path,
          "Candle must be an object.",
        ),
      ];
    }
    const prices = [item.open, item.high, item.low, item.close];
    if (
      item.instrumentId !== request.instrumentId ||
      item.timeframeId !== request.timeframeId ||
      typeof item.openTimeMs !== "number" ||
      !Number.isSafeInteger(item.openTimeMs) ||
      prices.some(
        (price) => typeof price !== "number" || !Number.isFinite(price),
      )
    ) {
      return [
        violation(
          "MALFORMED_PROVIDER_VALUE",
          path,
          "Candle must match the request and contain finite OHLC values.",
        ),
      ];
    }
    const [open, high, low, close] = prices as [number, number, number, number];
    if (
      high < Math.max(open, low, close) ||
      low > Math.min(open, high, close)
    ) {
      return [
        violation(
          "MALFORMED_PROVIDER_VALUE",
          path,
          "Candle violates high/low invariants.",
        ),
      ];
    }
    return [];
  });
}

async function capture<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<{ value?: T; violations: ProviderContractViolation[] }> {
  try {
    return { value: await operation(), violations: [] };
  } catch {
    return {
      violations: [
        violation(
          "PROVIDER_OPERATION_FAILED",
          path,
          `${path} threw or rejected.`,
        ),
      ],
    };
  }
}

export function createProviderContractFixture(
  options: ProviderContractFixtureOptions = {},
): ProviderContractFixture {
  const calls: ProviderFixtureCall[] = [];
  const candles: readonly Candle[] = options.candles ?? [
    {
      instrumentId,
      timeframeId,
      openTimeMs: 1_800_000_000_000,
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 25,
    },
  ];
  const ticks: readonly Tick[] = options.ticks ?? [
    { instrumentId, timestampMs: 1_800_000_030_000, price: 101.5, volume: 2 },
  ];
  const instruments: readonly ProviderInstrument[] = options.instruments ?? [
    { id: instrumentId, symbol: "FIX", name: "Fixture Instrument" },
  ];
  const capabilities: ProviderCapabilities = options.capabilities ?? {
    instruments: true,
    nativeTimeframes: [timeframeId],
    liveData: true,
    derivedTimeframes: false,
  };
  const adapter: ProviderAdapter = {
    connect: async () => {
      calls.push("connect");
    },
    disconnect: async () => {
      calls.push("disconnect");
    },
    getCapabilities: async () => {
      calls.push("getCapabilities");
      return capabilities;
    },
    getInstruments: async () => {
      calls.push("getInstruments");
      return instruments;
    },
    requestHistory: async () => {
      calls.push("requestHistory");
      return candles;
    },
    subscribe: async (_request, sink) => {
      calls.push("subscribe");
      sink.onTicks(ticks);
      return {
        unsubscribe: async () => {
          calls.push("unsubscribe");
        },
      };
    },
  };
  const definition = defineProvider({
    metadata: {
      id: providerId,
      name: "Fixture Provider",
      providerContractVersion: providerSdkVersion,
      hostCompatibility: {
        minimumHostApiVersion: hostApiVersion,
        maximumHostApiVersion: hostApiVersion,
      },
    },
    version: "1.0.0",
    config: {
      endpoint: config.string({
        defaultValue: "https://example.invalid",
        requiresReconnect: true,
      }),
      token: config.secret("token", {
        required: true,
        requiresReconnect: true,
      }),
    },
    create: async () => {
      calls.push("create");
      return adapter;
    },
  });
  return {
    definition,
    adapter,
    historyRequest: { instrumentId, timeframeId, limit: 100 },
    subscriptionRequest: { instrumentId, timeframeId },
    calls,
    candles,
    ticks,
    instruments,
  };
}

export async function instantiateProviderContractFixture(
  fixture: ProviderContractFixture,
): Promise<ProviderAdapter> {
  const host: ProviderHostServices = {
    network: {
      request: async () => ({
        status: 200,
        headers: {},
        body: new Uint8Array(),
      }),
    },
    credentials: { get: async () => null },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    now: () => 1_800_000_000_000,
    reportStatus: () => undefined,
  };
  return fixture.definition.create(host, {});
}

export async function runProviderContractConformance(
  subject: ProviderContractSubject,
): Promise<ProviderContractReport> {
  const violations = inspectDefinition(subject.definition);
  const connected = await capture("adapter.connect", () =>
    subject.adapter.connect(),
  );
  violations.push(...connected.violations);
  const capabilities = await capture("adapter.getCapabilities", () =>
    subject.adapter.getCapabilities(),
  );
  violations.push(...capabilities.violations);
  if (capabilities.value !== undefined) {
    violations.push(...inspectCapabilities(capabilities.value));
  }
  const instruments = await capture("adapter.getInstruments", () =>
    subject.adapter.getInstruments(),
  );
  violations.push(...instruments.violations);
  if (instruments.value !== undefined) {
    violations.push(...inspectInstruments(instruments.value));
  }
  const history = await capture("adapter.requestHistory", () =>
    subject.adapter.requestHistory(subject.historyRequest),
  );
  violations.push(...history.violations);
  if (history.value !== undefined) {
    violations.push(...inspectCandles(history.value, subject.historyRequest));
  }
  const sink: ProviderDataSink = {
    onCandles: () => undefined,
    onTicks: () => undefined,
    onError: () => undefined,
  };
  const subscription = await capture("adapter.subscribe", () =>
    subject.adapter.subscribe(subject.subscriptionRequest, sink),
  );
  violations.push(...subscription.violations);
  if (
    subscription.value === undefined ||
    typeof subscription.value.unsubscribe !== "function"
  ) {
    violations.push(
      violation(
        "MALFORMED_PROVIDER_VALUE",
        "subscription.unsubscribe",
        "Subscription must expose unsubscribe().",
      ),
    );
  } else {
    const activeSubscription = subscription.value;
    const unsubscribed = await capture("subscription.unsubscribe", () =>
      activeSubscription.unsubscribe(),
    );
    violations.push(...unsubscribed.violations);
  }
  const disconnected = await capture("adapter.disconnect", () =>
    subject.adapter.disconnect(),
  );
  violations.push(...disconnected.violations);
  return { ok: violations.length === 0, violations };
}
