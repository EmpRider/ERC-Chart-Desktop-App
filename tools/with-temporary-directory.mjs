import { mkdtemp, rm } from "node:fs/promises";

export async function withTemporaryDirectory(prefix, run) {
  const directory = await mkdtemp(prefix);
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
