import assert from "node:assert/strict";
import test from "node:test";
import {
  isImportedProviderSession,
  isProviderImportCredentialValues,
  isProviderImportPreview,
  isProviderImportPreviewResult,
  providerImportApproveChannel,
  providerImportCancelChannel,
  providerImportPreviewChannel,
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
