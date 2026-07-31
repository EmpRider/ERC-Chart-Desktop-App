import process from "node:process";

const [owner, gate] = process.argv.slice(2);
console.error(
  `${gate} is deferred to ${owner}; no installer result is claimed by ECDD-54.`,
);
process.exitCode = 1;
