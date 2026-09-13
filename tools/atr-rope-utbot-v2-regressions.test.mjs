import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  atrRopeUtBotPackageIdentity,
  buildAtrRopeUtBotIndicatorPackage,
} from "./build-atr-rope-utbot-indicator.mjs";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(
  repoRoot,
  "packages",
  "indicator-examples",
  "src",
  "atr-rope-utbot.ts",
);
const context = Object.freeze({
  instrumentId: "fixture.instrument",
  timeframeId: "1m",
});

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
      instrumentId: context.instrumentId,
      timeframeId: context.timeframeId,
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

function normalizedSemantics(indicator, snapshot) {
  const keys = outputKeys(indicator);
  const round = (value) =>
    typeof value === "number" && Number.isFinite(value)
      ? Number(value.toFixed(8))
      : value;
  return {
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
    overlays: snapshot.overlays,
  };
}

function semanticDigest(indicator, overrides) {
  const instance = indicator.createInstance(
    labeledParameters(indicator, overrides),
    context,
  );
  try {
    instance.onHistory(candles());
    const semantics = normalizedSemantics(indicator, instance.snapshot());
    const digestable = {
      points: semantics.points,
      signals: semantics.signals,
    };
    return {
      digest: createHash("sha256")
        .update(JSON.stringify(digestable))
        .digest("hex"),
      signalCount: digestable.signals.length,
    };
  } finally {
    instance.dispose();
  }
}

function definitionIdentity(indicator) {
  return {
    inputs: indicator.definition.inputs.map(({ key, group, label }) => ({
      key,
      group,
      label,
    })),
    plots: indicator.definition.plots.map(
      ({ key, outputKey, label, kind }) => ({ key, outputKey, label, kind }),
    ),
  };
}

async function importBuiltIndicator(packageRoot, tag) {
  const entry = path.join(packageRoot, "dist", "index.js");
  const module = await import(`${pathToFileURL(entry).href}?${tag}=${Date.now()}`);
  assert.ok(module.default?.definition);
  return module.default;
}

function reorderUnrelatedTopLevelDeclarations(source) {
  const ropeStart = source.indexOf("const ropeModes = [");
  const ropeEndMarker = "] as const;";
  const ropeEnd = source.indexOf(ropeEndMarker, ropeStart) + ropeEndMarker.length;
  const utStart = source.indexOf('const utModes = ["original", "0lag"] as const;');
  const utEnd = source.indexOf(";", utStart) + 1;
  assert.ok(ropeStart >= 0 && ropeEnd > ropeStart, "Missing ropeModes declaration");
  assert.ok(utStart > ropeEnd && utEnd > utStart, "Missing utModes declaration");
  return (
    source.slice(0, ropeStart) +
    source.slice(utStart, utEnd) +
    "\n" +
    source.slice(ropeStart, ropeEnd) +
    source.slice(utEnd)
  );
}

test("approved ATR Rope + UT Bot semantics survive provisional replacement and finalized advancement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "erc-ecdd228-lifecycle-"));
  try {
    const built = await buildAtrRopeUtBotIndicatorPackage({
      root: repoRoot,
      outputRoot: path.join(root, "package"),
    });
    const indicator = await importBuiltIndicator(built.packageRoot, "lifecycle");
    const sequence = candles(181);
    const approvedHistory = sequence.slice(0, -1);
    const prior = approvedHistory.slice(0, -1);
    const building = approvedHistory.at(-1);
    const next = sequence.at(-1);
    assert.ok(building && next && prior.length > 0);

    for (const [name, overrides] of Object.entries(cases)) {
      assert.deepEqual(
        semanticDigest(indicator, overrides),
        expectedSemantics[name],
        `${name} approved history fixture changed`,
      );

      const parameters = labeledParameters(indicator, overrides);
      const incremental = indicator.createInstance(parameters, context);
      const reference = indicator.createInstance(parameters, context);
      try {
        incremental.onHistory(prior);
        incremental.onFinalizedBar(prior.at(-1));
        incremental.onBuildingBar(building);
        reference.onHistory(approvedHistory);
        assert.deepEqual(
          normalizedSemantics(indicator, incremental.snapshot()),
          normalizedSemantics(indicator, reference.snapshot()),
          `${name} provisional state diverged from full-history replay`,
        );

        const replacement = {
          ...building,
          high: building.high + 0.11,
          low: building.low - 0.07,
          close: building.close + 0.05,
        };
        incremental.onBuildingBar(replacement);
        reference.onHistory([...prior, replacement]);
        assert.deepEqual(
          normalizedSemantics(indicator, incremental.snapshot()),
          normalizedSemantics(indicator, reference.snapshot()),
          `${name} provisional replacement failed to roll back prior building state`,
        );

        incremental.onFinalizedBar(replacement);
        incremental.onBuildingBar(next);
        reference.onHistory([...prior, replacement, next]);
        assert.deepEqual(
          normalizedSemantics(indicator, incremental.snapshot()),
          normalizedSemantics(indicator, reference.snapshot()),
          `${name} finalized advancement diverged from fresh replay`,
        );
      } finally {
        incremental.dispose();
        reference.dispose();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unrelated authoring source reorder preserves hidden identities and approved semantics", async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "erc-ecdd228-reorder-"));
  const authoringRoot = await mkdtemp(path.join(repoRoot, ".ecdd228-authoring-"));
  try {
    const originalBuild = await buildAtrRopeUtBotIndicatorPackage({
      root: repoRoot,
      outputRoot: path.join(outputRoot, "original"),
    });
    const original = await importBuiltIndicator(originalBuild.packageRoot, "original");

    const source = await readFile(sourcePath, "utf8");
    const reordered = reorderUnrelatedTopLevelDeclarations(source);
    const variantSourceDirectory = path.join(authoringRoot, "src");
    await mkdir(variantSourceDirectory, { recursive: true });
    await writeFile(
      path.join(authoringRoot, "package.json"),
      JSON.stringify({ name: "ecdd228-authoring-fixture", private: true, type: "module" }),
      "utf8",
    );
    const variantSource = path.join(variantSourceDirectory, "atr-rope-utbot.ts");
    await writeFile(variantSource, reordered, "utf8");

    const reorderedBuild = await buildIndicatorPackage({
      ...atrRopeUtBotPackageIdentity,
      source: variantSource,
      outputRoot: path.join(outputRoot, "reordered"),
      description: "ECDD-228 authoring source reorder regression fixture.",
    });
    const reorderedIndicator = await importBuiltIndicator(
      reorderedBuild.packageRoot,
      "reordered",
    );

    assert.deepEqual(
      definitionIdentity(reorderedIndicator),
      definitionIdentity(original),
      "compiler-owned input/plot identities changed after unrelated source reorder",
    );
    for (const [name, overrides] of Object.entries(cases)) {
      assert.deepEqual(
        semanticDigest(reorderedIndicator, overrides),
        expectedSemantics[name],
        `${name} semantics changed after unrelated source reorder`,
      );
    }
  } finally {
    await rm(authoringRoot, { recursive: true, force: true });
    await rm(outputRoot, { recursive: true, force: true });
  }
});
