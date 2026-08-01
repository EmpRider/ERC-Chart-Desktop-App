import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialWorkspace,
  createWorkspaceStore,
  workspaceReducer,
} from "../dist/index.js";

test("creates one active tab with one stable chart slot", () => {
  assert.deepEqual(createInitialWorkspace(), {
    tabs: [
      {
        id: "tab-1",
        title: "Chart 1",
        layoutSize: 1,
        slots: [{ id: "tab-1-chart-1" }],
      },
    ],
    activeTabId: "tab-1",
    nextTabNumber: 2,
  });
});

test("adds, selects, and closes tabs deterministically", () => {
  const initial = createInitialWorkspace();
  const added = workspaceReducer(initial, { type: "add-tab" });

  assert.equal(added.tabs.length, 2);
  assert.equal(added.activeTabId, "tab-2");
  assert.equal(added.nextTabNumber, 3);

  const selected = workspaceReducer(added, {
    type: "select-tab",
    tabId: "tab-1",
  });
  assert.equal(selected.activeTabId, "tab-1");

  const closed = workspaceReducer(selected, {
    type: "close-tab",
    tabId: "tab-1",
  });
  assert.deepEqual(
    closed.tabs.map((tab) => tab.id),
    ["tab-2"],
  );
  assert.equal(closed.activeTabId, "tab-2");
});

test("supports one-to-four slots while preserving stable IDs", () => {
  const initial = createInitialWorkspace();
  const four = workspaceReducer(initial, {
    type: "set-layout",
    tabId: "tab-1",
    layoutSize: 4,
  });

  assert.deepEqual(
    four.tabs[0].slots.map((slot) => slot.id),
    ["tab-1-chart-1", "tab-1-chart-2", "tab-1-chart-3", "tab-1-chart-4"],
  );

  const two = workspaceReducer(four, {
    type: "set-layout",
    tabId: "tab-1",
    layoutSize: 2,
  });
  assert.deepEqual(
    two.tabs[0].slots.map((slot) => slot.id),
    ["tab-1-chart-1", "tab-1-chart-2"],
  );
});

test("rejects invalid actions and always retains one tab", () => {
  const initial = createInitialWorkspace();

  assert.equal(
    workspaceReducer(initial, { type: "close-tab", tabId: "tab-1" }),
    initial,
  );
  assert.equal(
    workspaceReducer(initial, { type: "select-tab", tabId: "missing" }),
    initial,
  );
  assert.equal(
    workspaceReducer(initial, {
      type: "set-layout",
      tabId: "tab-1",
      layoutSize: 5,
    }),
    initial,
  );
});

test("notifies store subscribers only for state changes", () => {
  const store = createWorkspaceStore();
  const snapshots = [];
  const unsubscribe = store.subscribe(() =>
    snapshots.push(store.getSnapshot()),
  );

  store.dispatch({ type: "select-tab", tabId: "missing" });
  store.dispatch({ type: "add-tab" });
  unsubscribe();
  store.dispatch({ type: "add-tab" });

  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].activeTabId, "tab-2");
  assert.equal(store.getSnapshot().activeTabId, "tab-3");
});
