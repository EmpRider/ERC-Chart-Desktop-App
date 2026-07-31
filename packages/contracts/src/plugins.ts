import type { ContractVersion } from "./versions.js";

export type PluginKind = "provider" | "indicator";

export interface CompatibilityRange {
  readonly minimumHostApiVersion: ContractVersion;
  readonly maximumHostApiVersion: ContractVersion;
}
