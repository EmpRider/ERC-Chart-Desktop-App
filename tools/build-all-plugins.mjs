import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBinomoProviderPackage } from "./build-binomo-provider.mjs";
import { buildAtrRopeUtBotIndicatorPackage } from "./build-atr-rope-utbot-indicator.mjs";
import { buildIndicatorPackage } from "./build-indicator-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(root, "out");

// Register distributable plugins here when adding a new package builder.
// The candle/tick provider SDK fixtures are compiled but not packaged.
const packages = [
  {
    directory: "provider-plugins/binomo-provider",
    build: buildBinomoProviderPackage,
  },
  {
    directory: "indicator-plugins/atr-rope-utbot",
    build: buildAtrRopeUtBotIndicatorPackage,
  },
  {
    directory: "indicator-plugins/erc.indicator.atr-bands",
    build: ({ outputRoot }) =>
      buildIndicatorPackage({
        source: path.join(root, "packages/indicator-examples/src/atr-bands.ts"),
        id: "erc.indicator.atr-bands",
        version: "0.1.0",
        outputRoot,
      }),
  },
];

for (const entry of packages) {
  const packageRoot = path.resolve(outputRoot, entry.directory);
  const relative = path.relative(outputRoot, packageRoot);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Plugin output must be a child of ${outputRoot}`);
  }
  const result = await entry.build({ root, outputRoot: packageRoot });
  console.log(
    `PLUGIN_PACKAGE ${result.manifest.id}@${result.manifest.version} ${result.packageRoot}`,
  );
}

console.log(`Built ${packages.length} plugin packages.`);
