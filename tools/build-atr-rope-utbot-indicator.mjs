import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

export const atrRopeUtBotPackageIdentity = Object.freeze({
  id: "erc.indicator.atr-rope-utbot",
  name: "ATR Rope + UT Bot Unified",
  version: "0.1.3",
});

export async function buildAtrRopeUtBotIndicatorPackage({ root, outputRoot }) {
  return buildIndicatorPackage({
    ...atrRopeUtBotPackageIdentity,
    source: path.join(
      root,
      "packages",
      "indicator-examples",
      "src",
      "atr-rope-utbot.ts",
    ),
    outputRoot,
    description:
      "ATR Rope, UT Bot, follow signals, and rolling ADX POC migration for the ERC Chart Indicator SDK.",
  });
}

const currentFile = fileURLToPath(import.meta.url);
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === currentFile
) {
  const root = path.resolve(path.dirname(currentFile), "..");
  const result = await buildAtrRopeUtBotIndicatorPackage({
    root,
    outputRoot: path.join(root, "out", "indicator-plugins", "atr-rope-utbot"),
  });
  console.log(`ATR_ROPE_UTBOT_INDICATOR_PACKAGE ${result.packageRoot}`);
}
