import {
  isPersistedWorkspace,
  type PersistedWorkspace,
  type PersistedWorkspaceChartSlot,
} from "@erc-chart/contracts";
import type { LayoutSize, WorkspaceState } from "./workspace.js";

const workspaceId = "last-workspace";
const defaultProviderProfileId = "local-default";
const defaultInstrumentId = "UNCONFIGURED";
const defaultTimeframeSeconds = 60;

const layoutToSize = {
  "grid-1": 1,
  "split-horizontal": 2,
  "split-vertical": 2,
  "grid-3-left": 3,
  "grid-3-top": 3,
  "grid-4": 4,
} as const;

function layoutForSize(
  layoutSize: LayoutSize,
): PersistedWorkspace["tabs"][number]["layout"] {
  switch (layoutSize) {
    case 1:
      return "grid-1";
    case 2:
      return "split-horizontal";
    case 3:
      return "grid-3-left";
    case 4:
      return "grid-4";
  }
}

function nextNumber(ids: readonly string[], pattern: RegExp): number {
  let maximum = 0;
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match?.[1] !== undefined) maximum = Math.max(maximum, Number(match[1]));
  }
  return maximum + 1;
}

export function toPersistedWorkspace(
  state: WorkspaceState,
  savedAtMs: number = Date.now(),
): PersistedWorkspace {
  return {
    schemaVersion: 1,
    id: workspaceId,
    name: "Last workspace",
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      ...(tab.providerProfileId === undefined
        ? {}
        : { providerProfileId: tab.providerProfileId }),
      layout: tab.persistedLayout ?? layoutForSize(tab.layoutSize),
      chartSlots: tab.slots.map((slot) => {
        const persisted: Omit<PersistedWorkspaceChartSlot, "id"> =
          slot.persisted ?? {
            providerProfileId: defaultProviderProfileId,
            instrumentId: defaultInstrumentId,
            timeframeSeconds: defaultTimeframeSeconds,
            chartType: "candlestick",
            indicators: [],
          };
        return {
          id: slot.id,
          ...persisted,
          providerProfileId:
            tab.providerProfileId ?? persisted.providerProfileId,
        };
      }),
    })),
    savedAtMs,
  };
}

export function fromPersistedWorkspace(
  value: unknown,
): WorkspaceState | undefined {
  if (
    !isPersistedWorkspace(value) ||
    value.id !== workspaceId ||
    value.tabs.some((tab) => layoutToSize[tab.layout] !== tab.chartSlots.length)
  )
    return undefined;
  const tabs = value.tabs.map((tab) => {
    const providerProfileId =
      tab.providerProfileId ??
      tab.chartSlots.find((slot) => slot.instrumentId !== defaultInstrumentId)
        ?.providerProfileId;
    return {
      id: tab.id,
      title: tab.title,
      ...(providerProfileId === undefined ? {} : { providerProfileId }),
      layoutSize: layoutToSize[tab.layout],
      persistedLayout: tab.layout,
      slots: tab.chartSlots.map(({ id, ...persisted }) => ({ id, persisted })),
      nextWorkspaceNumber: nextNumber(
        tab.chartSlots.map(({ id }) => id),
        new RegExp(
          `^${tab.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-chart-(\\d+)$`,
        ),
      ),
    };
  });
  return {
    tabs,
    activeTabId: value.activeTabId,
    nextTabNumber: nextNumber(
      tabs.map(({ id }) => id),
      /^tab-(\d+)$/,
    ),
  };
}
