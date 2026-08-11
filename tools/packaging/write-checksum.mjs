import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applicationVersion,
  checksumLine,
  installerArtifactName,
} from "./packaging-contract.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const fileName = installerArtifactName(applicationVersion);
const artifactPath = path.join(root, "release", fileName);
const digest = createHash("sha256")
  .update(await readFile(artifactPath))
  .digest("hex");
await writeFile(
  `${artifactPath}.sha256`,
  checksumLine(digest, fileName),
  "utf8",
);
