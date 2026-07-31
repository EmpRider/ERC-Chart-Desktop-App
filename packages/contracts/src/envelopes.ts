import type { ContractVersion } from "./versions.js";

export interface RequestEnvelope<T> {
  readonly contractVersion: ContractVersion;
  readonly requestId: string;
  readonly generation: number;
  readonly payload: T;
}

export interface ResponseEnvelope<T> {
  readonly contractVersion: ContractVersion;
  readonly requestId: string;
  readonly generation: number;
  readonly revision: number;
  readonly payload: T;
}

export interface ErrorEnvelope {
  readonly contractVersion: ContractVersion;
  readonly requestId: string;
  readonly generation: number;
  readonly code: string;
  readonly safeMessage: string;
}
