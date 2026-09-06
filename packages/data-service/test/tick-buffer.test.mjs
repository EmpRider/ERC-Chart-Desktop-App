import assert from "node:assert/strict";
import test from "node:test";
import { createBoundedTickBuffer } from "../dist/index.js";

const key = { providerProfileId: "profile-a", instrumentId: "BTCUSD" };

test("keeps only the configured live tick tail", () => {
  const buffer = createBoundedTickBuffer(3);
  buffer.append(key, [
    { instrumentId: "BTCUSD", timestampMs: 1, price: 10 },
    { instrumentId: "BTCUSD", timestampMs: 2, price: 11 },
    { instrumentId: "BTCUSD", timestampMs: 3, price: 12 },
    { instrumentId: "BTCUSD", timestampMs: 4, price: 13 },
  ]);
  assert.deepEqual(
    buffer.snapshot(key).map(({ timestampMs }) => timestampMs),
    [2, 3, 4],
  );
});

test("ECDD-96 acceptance: drops duplicate, out-of-order, and obsolete ticks deterministically", () => {
  const buffer = createBoundedTickBuffer(4);
  buffer.append(key, [{ instrumentId: "BTCUSD", timestampMs: 10, price: 10 }]);
  assert.deepEqual(
    buffer.append(key, [
      { instrumentId: "BTCUSD", timestampMs: 10, price: 10 },
      { instrumentId: "BTCUSD", timestampMs: 9, price: 99 },
      { instrumentId: "BTCUSD", timestampMs: 11, price: 11 },
      { instrumentId: "BTCUSD", timestampMs: 8, price: 98 },
    ]),
    [{ instrumentId: "BTCUSD", timestampMs: 11, price: 11 }],
  );
  assert.deepEqual(
    buffer
      .snapshot(key)
      .map(({ timestampMs, price }) => ({ timestampMs, price })),
    [
      { timestampMs: 10, price: 10 },
      { timestampMs: 11, price: 11 },
    ],
  );
});

test("isolates tick buffers per provider profile", () => {
  const buffer = createBoundedTickBuffer(4);
  buffer.append(key, [{ instrumentId: "BTCUSD", timestampMs: 1, price: 10 }]);
  const other = { ...key, providerProfileId: "profile-b" };
  buffer.append(other, [{ instrumentId: "BTCUSD", timestampMs: 1, price: 20 }]);
  buffer.clearProfile("profile-a");
  assert.deepEqual(buffer.snapshot(key), []);
  assert.equal(buffer.snapshot(other)[0].price, 20);
});
