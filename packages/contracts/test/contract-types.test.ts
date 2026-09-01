import type {
  Candle,
  ContractVersion,
  InstrumentId,
  PluginManifest,
  RequestEnvelope,
} from "../src/index.js";

declare const contractVersion: ContractVersion;
declare const instrumentId: InstrumentId;

const candle: Candle = {
  instrumentId,
  timeframeId: "1m" as Candle["timeframeId"],
  openTimeMs: 1_800_000_000_000,
  open: 100,
  high: 102,
  low: 99,
  close: 101,
};

const request: RequestEnvelope<Candle> = {
  contractVersion,
  requestId: "request-1",
  generation: 1,
  payload: candle,
};

void request;

const pluginManifest: PluginManifest = {
  manifestVersion: contractVersion,
  id: "com.erc-chart.provider.fixture",
  kind: "provider",
  name: "Fixture Provider",
  version: "1.0.0",
  apiVersion: "^1.0.0",
  entry: "dist/index.js",
  authoringLanguage: "typescript",
  permissions: {
    network: ["https://api.example.com/"],
    credentials: ["auth_token"],
    storage: ["provider-cache"],
  },
};

void pluginManifest;

// @ts-expect-error Contract versions must be created through the validated constructor.
const invalidVersion: ContractVersion = 1;

// @ts-expect-error Instrument identifiers are distinct from arbitrary strings.
const invalidInstrument: InstrumentId = "BTCUSD";

// @ts-expect-error Every request crossing a boundary carries its contract version.
const missingVersion: RequestEnvelope<Candle> = {
  requestId: "request-2",
  generation: 1,
  payload: candle,
};

void invalidVersion;
void invalidInstrument;
void missingVersion;
