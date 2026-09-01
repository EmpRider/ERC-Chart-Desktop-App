import {
  createProviderContractFixture,
  type ProviderContractFixture,
  type ProviderContractReport,
} from "../src/index.js";

const fixture: ProviderContractFixture = createProviderContractFixture();
const report: ProviderContractReport = { ok: true, violations: [] };
void fixture;
void report;
