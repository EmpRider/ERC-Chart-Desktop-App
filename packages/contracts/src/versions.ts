declare const contractVersionBrand: unique symbol;

export type ContractVersion = number & {
  readonly [contractVersionBrand]: "ContractVersion";
};

export function contractVersion(value: number): ContractVersion {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("Contract version must be a positive safe integer.");
  }
  return value as ContractVersion;
}

export const hostApiVersion: ContractVersion = contractVersion(1);
export const ipcContractVersion: ContractVersion = contractVersion(1);
export const providerContractVersion: ContractVersion = contractVersion(1);
export const indicatorContractVersion: ContractVersion = contractVersion(1);
export const manifestVersion: ContractVersion = contractVersion(1);
export const workspaceSchemaVersion: ContractVersion = contractVersion(1);
export const marketDataContractVersion: ContractVersion = contractVersion(1);
export const databaseSchemaVersion: ContractVersion = contractVersion(1);
