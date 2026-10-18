import {
  isPersistedWorkspace,
  type PersistedWorkspace,
  type PersistedWorkspaceChartSlot,
  type PersistedWorkspaceTab,
  type WorkspaceIndicator,
  type WorkspaceIndicatorInput,
  type WorkspaceViewport,
} from "@erc-chart/contracts";

export { isPersistedWorkspace as validateWorkspaceV1 };
export type {
  PersistedWorkspace as WorkspaceV1,
  PersistedWorkspaceChartSlot as WorkspaceChartSlot,
  PersistedWorkspaceTab as WorkspaceTab,
  WorkspaceIndicator,
  WorkspaceIndicatorInput,
  WorkspaceViewport,
};

function readWorkspaceVersion(value: unknown): unknown {
  try {
    return typeof value === "object" &&
      value !== null &&
      Object.hasOwn(value, "schemaVersion")
      ? (value as { readonly schemaVersion: unknown }).schemaVersion
      : 1;
  } catch {
    return 1;
  }
}

function assertSupportedWorkspaceVersion(value: unknown): void {
  const version = readWorkspaceVersion(value);
  if (version !== 1)
    throw new Error(
      `Unsupported workspace schema version: ${String(version)}.`,
    );
}

export function serializeWorkspaceV1(value: unknown): string {
  assertSupportedWorkspaceVersion(value);
  if (!isPersistedWorkspace(value))
    throw new Error("Invalid workspace v1 document.");
  return JSON.stringify(value);
}

export function parseWorkspaceV1(serialized: string): PersistedWorkspace {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Workspace v1 document must be valid JSON.", {
      cause: error,
    });
  }
  assertSupportedWorkspaceVersion(value);
  if (!isPersistedWorkspace(value))
    throw new Error("Invalid workspace v1 document.");
  return value;
}
