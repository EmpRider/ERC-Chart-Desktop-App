import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { buildAtrRopeUtBotIndicatorPackage } from "./build-atr-rope-utbot-indicator.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(
  repoRoot,
  "packages",
  "indicator-examples",
  "src",
  "atr-rope-utbot.ts",
);

const expectedSemantics = Object.freeze({
  original: Object.freeze({
    digest: "be907268dc7114ff6f188b76013d0f194b4f140de60934458949914107e84db8",
    signalCount: 5,
  }),
  "momentum-zerolag": Object.freeze({
    digest: "e3ca6a710d724993c4406be8f21b8f2f65c0ce2c1dc2daaa5c58e424852a6c05",
    signalCount: 6,
  }),
  "adaptive-suppressed": Object.freeze({
    digest: "4682fb1e3f6a71932f1059cd86d4de0bf2a48215c75c544a55c355dc92914ab8",
    signalCount: 2,
  }),
  "follow-mg": Object.freeze({
    digest: "50a2dacdabc9b8e0c063843b2143ade969578122e7766d72e3c1a114ec7f186d",
    signalCount: 90,
  }),
});

function candles(length = 180) {
  return Array.from({ length }, (_, index) => index).reduce((result, index) => {
    const previous = result.at(-1)?.close ?? 100;
    const regime =
      index < 45
        ? index * 0.16
        : index < 90
          ? (90 - index) * 0.21 + 2
          : index < 135
            ? (index - 90) * 0.24 - 3
            : (180 - index) * 0.18 + 4;
    const close =
      100 +
      regime +
      Math.sin(index / 2.7) * 0.55 +
      Math.cos(index / 7.5) * 0.28;
    result.push({
      instrumentId: "fixture.instrument",
      timeframeId: "1m",
      openTimeMs: 1_900_000_000_000 + index * 60_000,
      open: previous,
      high: Math.max(previous, close) + 0.22 + (index % 5) * 0.015,
      low: Math.min(previous, close) - 0.19 - (index % 3) * 0.02,
      close,
      volume: 100 + index,
    });
    return result;
  }, []);
}

function labeledParameters(indicator, overrides = {}) {
  const parameters = Object.fromEntries(
    indicator.definition.inputs.map((input) => [input.key, input.defaultValue]),
  );
  for (const [selector, value] of Object.entries(overrides)) {
    const [group, label] = selector.split("::");
    const input = indicator.definition.inputs.find(
      (candidate) => candidate.group === group && candidate.label === label,
    );
    assert.ok(input, `Missing input ${selector}`);
    parameters[input.key] = value;
  }
  return parameters;
}

function outputKeys(indicator) {
  const labels = ["ATR Rope", "Direction Upper", "Direction Lower", "UT Stop"];
  return Object.fromEntries(
    labels.map((label) => {
      const plot = indicator.definition.plots.find(
        (candidate) => candidate.label === label,
      );
      assert.ok(plot, `Missing plot ${label}`);
      return [label, plot.outputKey ?? plot.key];
    }),
  );
}

function semanticDigest(indicator, overrides) {
  const keys = outputKeys(indicator);
  const instance = indicator.createInstance(
    labeledParameters(indicator, overrides),
    {
      instrumentId: "fixture.instrument",
      timeframeId: "1m",
    },
  );
  try {
    instance.onHistory(candles());
    const snapshot = instance.snapshot();
    const round = (value) =>
      typeof value === "number" && Number.isFinite(value)
        ? Number(value.toFixed(8))
        : value;
    const semantics = {
      points: snapshot.points.map((point) => ({
        openTimeMs: point.openTimeMs,
        values: Object.fromEntries(
          Object.entries(keys).map(([label, key]) => [
            label,
            round(point.values[key] ?? null),
          ]),
        ),
      })),
      signals: (snapshot.signals ?? []).map(({ direction, occurredAtMs }) => ({
        direction,
        occurredAtMs,
      })),
    };
    return {
      digest: createHash("sha256")
        .update(JSON.stringify(semantics))
        .digest("hex"),
      signalCount: semantics.signals.length,
    };
  } finally {
    instance.dispose();
  }
}

test("ATR Rope + UT Bot source uses the final SDK v2 authoring surface", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.doesNotMatch(source, /\bappendSeries\b/u);
  assert.doesNotMatch(source, /\blaggedValue\b/u);
  assert.match(source, /\bhistory\s*\(/u);
  assert.doesNotMatch(source, /\bkey\s*:/u);

  assert.match(source, /shape\.labelUp/u);
  assert.match(source, /shape\.labelDown/u);
  assert.match(source, /location\.belowBar/u);
  assert.match(source, /location\.aboveBar/u);
  assert.match(source, /textSize\.small/u);
  assert.match(source, /text:\s*["']BUY["']/u);
  assert.match(source, /text:\s*["']SELL["']/u);
  assert.doesNotMatch(source, /\bmarkerAtr\b|\bpadding\b/u);

  assert.match(source, /\.delete\(\)/u);
  assert.doesNotMatch(source, /compatib(?:ility|le).*v1|legacy.*shim/iu);
});

test("compiled ATR Rope + UT Bot preserves approved output and signal semantics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-ecdd224-v2-"));
  try {
    const built = await buildAtrRopeUtBotIndicatorPackage({
      root: repoRoot,
      outputRoot: path.join(root, "package"),
    });
    const entry = path.join(built.packageRoot, "dist", "index.js");
    const module = await import(
      `${pathToFileURL(entry).href}?ecdd224=${Date.now()}`
    );
    const indicator = module.default;
    assert.ok(indicator?.definition);

    const cases = Object.freeze({
      original: {},
      "momentum-zerolag": {
        "ATR Rope::ATR period": 5,
        "ATR Rope::Sensitivity mode": "momentum",
        "ATR Rope Direction::Direction lookback": 4,
        "ATR Rope Direction::Direction threshold": 0.03,
        "ATR Rope Direction::Direction MA": "tema",
        "UT Bot::ATR period": 4,
        "UT Bot::Mode": "0lag",
        "ADX POC::ADX / DI length": 5,
        "ADX POC::Profile period": 24,
        "ADX POC::Fast POC period": 8,
        "ADX POC::Minimum early bars": 5,
      },
      "adaptive-suppressed": {
        "ATR Rope::ATR period": 7,
        "ATR Rope::Sensitivity mode": "adaptive",
        "ATR Rope Direction::Direction lookback": 3,
        "ATR Rope Direction::Direction threshold": 0.02,
        "UT Bot::ATR period": 5,
        "ADX POC Suppression::Signal suppression": "Any",
        "ADX POC::ADX / DI length": 5,
        "ADX POC::Profile period": 24,
        "ADX POC::Fast POC period": 8,
        "ADX POC::Minimum early bars": 5,
      },
      "follow-mg": {
        "ATR Rope::ATR period": 4,
        "ATR Rope Direction::Direction lookback": 2,
        "ATR Rope Direction::Direction threshold": 0,
        "UT Bot::ATR period": 3,
        "Signals::Signal mode": "Win Follow + MG Follow",
        "Signals::MG follow steps": 2,
        "ADX POC::ADX / DI length": 4,
        "ADX POC::Profile period": 20,
        "ADX POC::Fast POC period": 6,
        "ADX POC::Minimum early bars": 4,
      },
    });

    for (const [name, overrides] of Object.entries(cases)) {
      assert.deepEqual(
        semanticDigest(indicator, overrides),
        expectedSemantics[name],
        `${name} trading semantics changed`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
