import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialWorkspace,
  createWorkspaceStore,
  maximumWorkspaces,
  workspaceReducer,
} from "../dist/index.js";

test("creates one active tab with one stable chart slot", () => {
  assert.equal(maximumWorkspaces, 4);
  assert.deepEqual(createInitialWorkspace(), {
    tabs: [
      {
        id: "tab-1",
        title: "Chart 1",
        layoutSize: 1,
        slots: [{ id: "tab-1-chart-1" }],
        nextWorkspaceNumber: 2,
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

test("adds workspaces one at a time and stops at four", () => {
  const initial = createInitialWorkspace();
  const two = workspaceReducer(initial, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  assert.notEqual(two, undefined);
  const three = workspaceReducer(two, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const completed = workspaceReducer(three, {
    type: "add-workspace",
    tabId: "tab-1",
  });

  assert.deepEqual(
    completed.tabs[0].slots.map((slot) => slot.id),
    ["tab-1-chart-1", "tab-1-chart-2", "tab-1-chart-3", "tab-1-chart-4"],
  );
  assert.equal(two.tabs[0].layoutSize, 2);
  assert.equal(completed.tabs[0].layoutSize, 4);
  assert.equal(completed.tabs[0].nextWorkspaceNumber, 5);
  assert.equal(
    workspaceReducer(completed, {
      type: "add-workspace",
      tabId: "tab-1",
    }),
    completed,
  );
});

test("removes only added workspaces and never reuses a workspace ID", () => {
  const initial = createInitialWorkspace();
  const two = workspaceReducer(initial, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  assert.notEqual(two, undefined);
  const three = workspaceReducer(two, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  const removed = workspaceReducer(three, {
    type: "remove-workspace",
    tabId: "tab-1",
    workspaceId: "tab-1-chart-2",
  });

  assert.deepEqual(
    removed.tabs[0].slots.map((slot) => slot.id),
    ["tab-1-chart-1", "tab-1-chart-3"],
  );
  assert.equal(removed.tabs[0].layoutSize, 2);
  assert.equal(removed.tabs[0].nextWorkspaceNumber, 4);
  assert.equal(
    workspaceReducer(removed, {
      type: "remove-workspace",
      tabId: "tab-1",
      workspaceId: "tab-1-chart-1",
    }),
    removed,
  );

  const addedAgain = workspaceReducer(removed, {
    type: "add-workspace",
    tabId: "tab-1",
  });
  assert.deepEqual(
    addedAgain.tabs[0].slots.map((slot) => slot.id),
    ["tab-1-chart-1", "tab-1-chart-3", "tab-1-chart-4"],
  );
});

test("fails closed when removal sees a malformed runtime layout size", () => {
  const malformed = {
    tabs: [
      {
        id: "tab-1",
        title: "Chart 1",
        // Runtime state may bypass TypeScript's closed LayoutSize domain.
        layoutSize: 5,
        slots: [{ id: "tab-1-chart-1" }, { id: "tab-1-chart-2" }],
        nextWorkspaceNumber: 3,
      },
    ],
    activeTabId: "tab-1",
    nextTabNumber: 2,
  };

  assert.equal(
    workspaceReducer(malformed, {
      type: "remove-workspace",
      tabId: "tab-1",
      workspaceId: "tab-1-chart-2",
    }),
    malformed,
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
    workspaceReducer(initial, { type: "add-workspace", tabId: "missing" }),
    initial,
  );
  assert.equal(
    workspaceReducer(initial, {
      type: "remove-workspace",
      tabId: "tab-1",
      workspaceId: "missing",
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

test("notifies the subscriber snapshot when listeners mutate subscriptions", () => {
  const store = createWorkspaceStore();
  const calls = [];
  let unsubscribeSecond = () => undefined;

  store.subscribe(() => {
    calls.push("first");
    unsubscribeSecond();
    store.subscribe(() => calls.push("late"));
  });
  unsubscribeSecond = store.subscribe(() => calls.push("second"));

  store.dispatch({ type: "add-tab" });

  assert.deepEqual(calls, ["first", "second"]);
});

test("does not notify subscribers when the workspace maximum is reached", () => {
  const maximum = {
    tabs: [
      {
        id: "tab-1",
        title: "Chart 1",
        layoutSize: 4,
        slots: [
          { id: "tab-1-chart-1" },
          { id: "tab-1-chart-2" },
          { id: "tab-1-chart-3" },
          { id: "tab-1-chart-4" },
        ],
        nextWorkspaceNumber: 5,
      },
    ],
    activeTabId: "tab-1",
    nextTabNumber: 2,
  };
  const store = createWorkspaceStore(maximum);
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  store.dispatch({ type: "add-workspace", tabId: "tab-1" });

  assert.equal(store.getSnapshot(), maximum);
  assert.equal(notifications, 0);
});
