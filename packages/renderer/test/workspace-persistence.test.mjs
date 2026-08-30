import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialWorkspace,
  fromPersistedWorkspace,
  toPersistedWorkspace,
  workspaceReducer,
} from "../dist/index.js";

function createThreeWorkspaceState() {
  const initial = createInitialWorkspace();
  const two = workspaceReducer(initial, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  return workspaceReducer(two, {
    type: "add-workspace",
    tabId: "tab-1",
  });
}

test("round-trips renderer workspace identity through storage v1", () => {
  const state = workspaceReducer(createThreeWorkspaceState(), {
    type: "add-tab",
  });
  const document = toPersistedWorkspace(state, 123);

  assert.equal(document.schemaVersion, 1);
  assert.equal(document.id, "last-workspace");
  assert.equal(document.savedAtMs, 123);
  assert.equal(document.tabs[0].layout, "grid-3-left");
  assert.deepEqual(
    document.tabs[0].chartSlots.map((slot) => slot.id),
    ["tab-1-chart-1", "tab-1-chart-2", "tab-1-chart-3"],
  );
  const restoredTabs = fromPersistedWorkspace(document)?.tabs.map((tab) => ({
    ...tab,
    slots: tab.slots.map(({ id }) => ({ id })),
  }));
  const normalizeTabs = (tabs) =>
    tabs.map((tab) => {
      const normalized = { ...tab };
      delete normalized.persistedLayout;
      return {
        ...normalized,
        slots: tab.slots.map(({ id }) => ({ id })),
      };
    });
  assert.deepEqual(
    normalizeTabs(restoredTabs ?? []),
    normalizeTabs(state.tabs),
  );
  assert.equal(
    fromPersistedWorkspace(document)?.activeTabId,
    state.activeTabId,
  );
  assert.equal(
    fromPersistedWorkspace(document)?.nextTabNumber,
    state.nextTabNumber,
  );
});

test("derives future identity counters from restored IDs", () => {
  const restored = fromPersistedWorkspace({
    ...toPersistedWorkspace(createThreeWorkspaceState(), 1),
    tabs: [
      {
        ...toPersistedWorkspace(createThreeWorkspaceState(), 1).tabs[0],
        chartSlots: [
          {
            ...toPersistedWorkspace(createThreeWorkspaceState(), 1).tabs[0]
              .chartSlots[0],
            id: "tab-1-chart-1",
          },
          {
            ...toPersistedWorkspace(createThreeWorkspaceState(), 1).tabs[0]
              .chartSlots[1],
            id: "tab-1-chart-9",
          },
        ],
        layout: "split-horizontal",
      },
      {
        ...toPersistedWorkspace(createThreeWorkspaceState(), 1).tabs[0],
        id: "tab-7",
        title: "Chart 7",
        chartSlots: [
          {
            ...toPersistedWorkspace(createThreeWorkspaceState(), 1).tabs[0]
              .chartSlots[0],
            id: "tab-7-chart-4",
          },
        ],
        layout: "grid-1",
      },
    ],
  });

  assert.equal(restored.nextTabNumber, 8);
  assert.equal(restored.tabs[0].nextWorkspaceNumber, 10);
  assert.equal(restored.tabs[1].nextWorkspaceNumber, 5);
});

test("preserves restored chart configuration on the next save", () => {
  const document = toPersistedWorkspace(createInitialWorkspace(), 1);
  const configured = {
    ...document,
    tabs: [
      {
        ...document.tabs[0],
        chartSlots: [
          {
            ...document.tabs[0].chartSlots[0],
            providerProfileId: "broker-primary",
            instrumentId: "EURUSD",
            timeframeSeconds: 300,
            chartType: "line",
            viewport: {
              visibleBars: 100,
              rightOffsetBars: 2,
              priceScaleMode: "auto",
            },
          },
        ],
      },
    ],
  };
  const restored = fromPersistedWorkspace(configured);

  assert.ok(restored);
  assert.deepEqual(toPersistedWorkspace(restored, 2).tabs[0].chartSlots[0], {
    ...configured.tabs[0].chartSlots[0],
  });
});

test("preserves persisted layout orientation on the next save", () => {
  const document = toPersistedWorkspace(
    workspaceReducer(createInitialWorkspace(), {
      type: "add-workspace",
      tabId: "tab-1",
    }),
    1,
  );
  for (const layout of ["split-vertical", "grid-3-top"]) {
    const oriented =
      layout === "split-vertical"
        ? { ...document, tabs: [{ ...document.tabs[0], layout }] }
        : {
            ...toPersistedWorkspace(createThreeWorkspaceState(), 1),
            tabs: [
              {
                ...toPersistedWorkspace(createThreeWorkspaceState(), 1).tabs[0],
                layout,
              },
            ],
          };
    const restored = fromPersistedWorkspace(oriented);
    assert.ok(restored);
    assert.equal(toPersistedWorkspace(restored, 2).tabs[0].layout, layout);
  }
});

test("uses a valid layout after mutating an oriented restored tab", () => {
  const two = toPersistedWorkspace(
    workspaceReducer(createInitialWorkspace(), {
      type: "add-workspace",
      tabId: "tab-1",
    }),
    1,
  );
  const restored = fromPersistedWorkspace({
    ...two,
    tabs: [{ ...two.tabs[0], layout: "split-vertical" }],
  });
  assert.ok(restored);
  const mutated = workspaceReducer(restored, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const saved = toPersistedWorkspace(mutated, 2);

  assert.equal(saved.tabs[0].layout, "grid-3-left");
  assert.ok(fromPersistedWorkspace(saved));
});

for (const invalid of [
  undefined,
  { schemaVersion: 1 },
  {
    ...toPersistedWorkspace(createInitialWorkspace(), 1),
    activeTabId: "missing",
  },
  {
    ...toPersistedWorkspace(createInitialWorkspace(), 1),
    tabs: [
      {
        ...toPersistedWorkspace(createInitialWorkspace(), 1).tabs[0],
        layout: "grid-4",
      },
    ],
  },
]) {
  test("rejects invalid persisted workspace without fallback overwrite", () => {
    assert.equal(fromPersistedWorkspace(invalid), undefined);
  });
}
