import type {
  InstrumentId,
  ProviderId,
  TimeframeId,
} from "@erc-chart/contracts";
import type {
  ProviderAdapter,
  ProviderPluginMetadata,
} from "@erc-chart/provider-sdk";
import {
  createProviderContractFixture,
  type ProviderContractCase,
  type ProviderContractSubject,
} from "../src/index.js";

const fixture = createProviderContractFixture();
const subject: ProviderContractSubject = fixture;
const fixtureCase: ProviderContractCase = {
  name: "current",
  value: {},
  expectedAccepted: true,
};

declare const providerId: ProviderId;
declare const instrumentId: InstrumentId;
declare const timeframeId: TimeframeId;
declare const metadata: ProviderPluginMetadata;
declare const adapter: ProviderAdapter;

// @ts-expect-error Provider conformance subjects require plugin metadata.
const missingMetadata: ProviderContractSubject = {
  adapter,
  historyRequest: { instrumentId, timeframeId },
  subscriptionRequest: { instrumentId, timeframeId },
};

const invalidMetadata: ProviderPluginMetadata = {
  ...metadata,
  // @ts-expect-error Fixture metadata must use a branded ProviderId.
  id: "arbitrary-provider",
};

void providerId;
void subject;
void fixtureCase;
void missingMetadata;
void invalidMetadata;
