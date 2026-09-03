import assert from "node:assert/strict";
import test from "node:test";
import { ipcContractVersion } from "@erc-chart/contracts";
import {
  isProviderUtilityChildMessage,
  isProviderUtilityParentMessage,
} from "../dist/index.js";

test("rejects undeclared nested network request IPC fields", () => {
  assert.equal(
    isProviderUtilityChildMessage({
      type: "provider-host-network-request",
      contractVersion: ipcContractVersion,
      requestId: "profile-a.1",
      request: {
        url: "https://api.example.com/v1/status",
        undeclared: "must-not-cross-ipc",
      },
    }),
    false,
  );
});

test("accepts bounded provider data operations and rejects malformed market data", () => {
  assert.equal(
    isProviderUtilityParentMessage({
      type: "provider-history-request",
      contractVersion: ipcContractVersion,
      requestId: "data.1",
      request: { instrumentId: "BTCUSD", timeframeId: "1m", limit: 500 },
    }),
    true,
  );
  assert.equal(
    isProviderUtilityParentMessage({
      type: "provider-history-request",
      contractVersion: ipcContractVersion,
      requestId: "data.2",
      request: { instrumentId: "BTCUSD", timeframeId: "1m", limit: 100_001 },
    }),
    false,
  );
  assert.equal(
    isProviderUtilityParentMessage({
      type: "provider-subscribe-request",
      contractVersion: ipcContractVersion,
      requestId: "data.3",
      subscriptionId: "sub.1",
      request: { instrumentId: "BTCUSD", timeframeId: "1m" },
    }),
    true,
  );
  assert.equal(
    isProviderUtilityChildMessage({
      type: "provider-subscription-ticks",
      contractVersion: ipcContractVersion,
      subscriptionId: "sub.1",
      ticks: [{ instrumentId: "BTCUSD", timestampMs: 1_000, price: 10 }],
    }),
    true,
  );
  assert.equal(
    isProviderUtilityChildMessage({
      type: "provider-subscription-candles",
      contractVersion: ipcContractVersion,
      subscriptionId: "sub.1",
      candles: [
        {
          instrumentId: "BTCUSD",
          timeframeId: "1m",
          openTimeMs: 1_000,
          open: 10,
          high: 9,
          low: 8,
          close: 10,
        },
      ],
    }),
    false,
  );
});
