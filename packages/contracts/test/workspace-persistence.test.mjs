import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkspaceLoadResult,
  isWorkspaceSaveRequest,
  workspaceLoadChannel,
  workspaceSaveChannel,
} from "../dist/index.js";

const workspace = {
  schemaVersion: 1,
  id: "last-workspace",
  name: "Last workspace",
  activeTabId: "tab-1",
  tabs: [
    {
      id: "tab-1",
      title: "Chart 1",
      providerProfileId: "local-default",
      layout: "split-horizontal",
      chartSlots: [
        {
          id: "tab-1-chart-1",
          providerProfileId: "local-default",
          instrumentId: "UNCONFIGURED",
          timeframeSeconds: 60,
          chartType: "candlestick",
          indicators: [],
        },
        {
          id: "tab-1-chart-2",
          providerProfileId: "local-default",
          instrumentId: "UNCONFIGURED",
          timeframeSeconds: 60,
          chartType: "candlestick",
          indicators: [],
        },
      ],
    },
  ],
  savedAtMs: 1,
};

test("defines fixed workspace persistence channels", () => {
  assert.equal(workspaceLoadChannel, "erc-chart:workspace-load");
  assert.equal(workspaceSaveChannel, "erc-chart:workspace-save");
});

test("validates workspace load and save IPC payloads", () => {
  assert.equal(isWorkspaceLoadResult(null), true);
  assert.equal(isWorkspaceLoadResult(workspace), true);
  assert.equal(isWorkspaceSaveRequest(workspace), true);
  assert.equal(
    isWorkspaceLoadResult({ ...workspace, activeTabId: "missing" }),
    false,
  );
  assert.equal(isWorkspaceSaveRequest({ ...workspace, savedAtMs: -1 }), false);
  assert.equal(
    isWorkspaceSaveRequest({
      ...workspace,
      tabs: [{ ...workspace.tabs[0], chartSlots: [] }],
    }),
    false,
  );
});
