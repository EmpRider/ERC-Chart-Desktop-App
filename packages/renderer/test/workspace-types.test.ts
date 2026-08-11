import type { WorkspaceAction } from "../src/workspace.js";

const validAddAction: WorkspaceAction = {
  type: "add-workspace",
  tabId: "tab-1",
};

const validRemoveAction: WorkspaceAction = {
  type: "remove-workspace",
  tabId: "tab-1",
  workspaceId: "tab-1-chart-2",
};

const removedLayoutAction: WorkspaceAction = {
  // @ts-expect-error Numeric layout selection is no longer a workspace action.
  type: "set-layout",
  tabId: "tab-1",
  layoutSize: 4,
};

void validAddAction;
void validRemoveAction;
void removedLayoutAction;
