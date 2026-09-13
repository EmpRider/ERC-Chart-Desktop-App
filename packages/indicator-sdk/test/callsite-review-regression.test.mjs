import assert from "node:assert/strict";
import test from "node:test";
import { readCompilerCallsite } from "../dist/internal/callsite.js";

test("frozen compiler callsites cache validated value snapshots", () => {
  const firstId = `erc-v2-drawing-${"1".padStart(24, "0")}`;
  const changedId = `erc-v2-drawing-${"2".padStart(24, "0")}`;
  let idReads = 0;
  const source = Object.freeze({ file: "fixture.ts", line: 1, column: 1 });
  const candidate = Object.freeze({
    get __ercCallsite() {
      return "v2";
    },
    get id() {
      idReads += 1;
      return idReads === 1 ? firstId : changedId;
    },
    get kind() {
      return "drawing";
    },
    get callee() {
      return "plot.box";
    },
    get source() {
      return source;
    },
  });

  const first = readCompilerCallsite(candidate, "drawing", "plot.box");
  assert.equal(first?.id, firstId);
  assert.equal(idReads, 1);
  assert.notEqual(first, candidate);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first?.source), true);

  const cached = readCompilerCallsite(candidate, "drawing", "plot.box");
  assert.equal(cached?.id, firstId);
  assert.equal(idReads, 1);
  assert.equal(cached, first);
});

test("non-frozen compiler callsites return validated value snapshots", () => {
  const firstId = `erc-v2-drawing-${"3".padStart(24, "0")}`;
  const changedId = `erc-v2-drawing-${"4".padStart(24, "0")}`;
  let idReads = 0;
  const candidate = {
    get __ercCallsite() {
      return "v2";
    },
    get id() {
      idReads += 1;
      return idReads === 1 ? firstId : changedId;
    },
    get kind() {
      return "drawing";
    },
    get callee() {
      return "plot.box";
    },
    get source() {
      return { file: "fixture.ts", line: 2, column: 3 };
    },
  };

  const first = readCompilerCallsite(candidate, "drawing", "plot.box");
  assert.equal(first?.id, firstId);
  assert.equal(idReads, 1);
  assert.notEqual(first, candidate);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first?.source), true);
});
