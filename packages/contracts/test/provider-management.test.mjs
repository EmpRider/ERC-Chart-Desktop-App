import assert from "node:assert/strict";
import test from "node:test";
import {
  isImportedProviderSession,
  isProviderLiveEvent,
  isProviderLiveRequest,
  isProviderLiveSubscriptionRequest,
  isProviderManagementSnapshot,
  isProviderProfileCreateRequest,
  isProviderProfileUpdateRequest,
  isProviderImportCredentialValues,
  isProviderImportPreview,
  isProviderImportPreviewResult,
  providerImportApproveChannel,
  providerImportCancelChannel,
  providerImportPreviewChannel,
  providerLiveEventChannel,
  providerLiveSubscribeChannel,
  providerLiveUnsubscribeChannel,
  providerProfileCreateChannel,
  providerProfileDeleteChannel,
  providerProfilesListChannel,
  providerProfileStartChannel,
  providerProfileStopChannel,
  providerProfileUpdateChannel,
} from "../dist/index.js";

test("pins the provider import IPC contract to narrow application channels", () => {
  assert.equal(
    providerImportPreviewChannel,
    "erc-chart:provider-import-preview",
  );
  assert.equal(
    providerImportApproveChannel,
    "erc-chart:provider-import-approve",
  );
  assert.equal(providerImportCancelChannel, "erc-chart:provider-import-cancel");
  assert.equal(
    providerLiveSubscribeChannel,
    "erc-chart:provider-live-subscribe",
  );
  assert.equal(
    providerLiveUnsubscribeChannel,
    "erc-chart:provider-live-unsubscribe",
  );
  assert.equal(providerLiveEventChannel, "erc-chart:provider-live-event");
  assert.equal(providerProfilesListChannel, "erc-chart:provider-profiles-list");
  assert.equal(
    providerProfileCreateChannel,
    "erc-chart:provider-profile-create",
  );
  assert.equal(
    providerProfileUpdateChannel,
    "erc-chart:provider-profile-update",
  );
  assert.equal(providerProfileStartChannel, "erc-chart:provider-profile-start");
  assert.equal(providerProfileStopChannel, "erc-chart:provider-profile-stop");
  assert.equal(
    providerProfileDeleteChannel,
    "erc-chart:provider-profile-delete",
  );
});

test("validates provider management snapshots and profile mutations", () => {
  const snapshot = {
    installedProviders: [
      {
        providerId: "erc.provider.fixture",
        providerName: "Fixture",
        version: "1.0.0",
        credentialKeys: ["auth_token"],
      },
    ],
    profiles: [
      {
        profileId: "profile-a",
        providerId: "erc.provider.fixture",
        providerName: "Fixture",
        version: "1.0.0",
        displayName: "Primary",
        status: "ready",
        settings: { region: "eu", retries: 2 },
        credentialKeys: ["auth_token"],
      },
    ],
  };
  assert.equal(isProviderManagementSnapshot(snapshot), true);
  assert.equal(
    isProviderProfileCreateRequest({
      providerId: "erc.provider.fixture",
      displayName: "Secondary",
      settings: { region: "us" },
      credentials: { auth_token: "fixture" },
    }),
    true,
  );
  assert.equal(
    isProviderProfileUpdateRequest({
      profileId: "profile-a",
      displayName: "Renamed",
      settings: { region: "us" },
    }),
    true,
  );
  assert.equal(
    isProviderProfileUpdateRequest({
      profileId: "profile-a",
      displayName: "Renamed",
      settings: { auth_token: "must-not-persist" },
    }),
    true,
  );
});

test("validates provider live subscription requests and candle events", () => {
  const request = {
    profileId: "erc.provider.binomo.default",
    instrumentId: "Z-CRY/IDX",
    timeframeId: "1m",
  };
  const subscriptionRequest = {
    ...request,
    subscriptionId: "provider-live-test-1",
  };
  const candle = {
    instrumentId: "Z-CRY/IDX",
    timeframeId: "1m",
    openTimeMs: 1_800_000_000_000,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
  };

  assert.equal(isProviderLiveRequest(request), true);
  assert.equal(isProviderLiveSubscriptionRequest(subscriptionRequest), true);
  assert.equal(
    isProviderLiveSubscriptionRequest({
      ...subscriptionRequest,
      subscriptionId: "bad id",
    }),
    false,
  );
  assert.equal(
    isProviderLiveEvent({
      subscriptionId: subscriptionRequest.subscriptionId,
      type: "candles",
      candles: [candle],
    }),
    true,
  );
  assert.equal(
    isProviderLiveEvent({
      subscriptionId: subscriptionRequest.subscriptionId,
      type: "error",
      code: "BINOMO_POLL_FAILED",
    }),
    true,
  );
  assert.equal(
    isProviderLiveEvent({
      subscriptionId: subscriptionRequest.subscriptionId,
      type: "candles",
      candles: [{ ...candle, close: Number.NaN }],
    }),
    false,
  );
});

test("validates provider import previews and loaded market-data sessions", () => {
  const preview = {
    requestId: "request-1",
    pluginId: "erc.provider.binomo",
    pluginName: "Binomo",
    pluginVersion: "0.1.0",
    mode: "developer",
    trust: "unsigned",
    permissions: {
      network: ["https://api.binomo.com/*"],
      credentials: [],
      storage: [],
    },
  };
  assert.equal(isProviderImportPreview(preview), true);
  assert.equal(isProviderImportPreviewResult(preview), true);
  assert.equal(isProviderImportPreviewResult(null), true);
  assert.equal(isProviderImportPreview({ ...preview, requestId: "" }), false);
  assert.equal(
    isProviderImportCredentialValues({ binomo_cookie: "fixture-cookie" }),
    true,
  );
  assert.equal(
    isProviderImportCredentialValues({ BinomoCookie: "value" }),
    false,
  );
  assert.equal(isProviderImportCredentialValues({ binomo_cookie: "" }), false);

  assert.equal(
    isImportedProviderSession({
      profileId: "erc.provider.binomo.default",
      providerId: "erc.provider.binomo",
      providerName: "Binomo",
      instrument: {
        id: "Z-CRY/IDX",
        symbol: "Z-CRY/IDX",
        name: "Z-CRY/IDX",
      },
      timeframeId: "1m",
      candles: [
        {
          instrumentId: "Z-CRY/IDX",
          timeframeId: "1m",
          openTimeMs: 1_800_000_000_000,
          open: 100,
          high: 102,
          low: 99,
          close: 101,
        },
      ],
    }),
    true,
  );
});
