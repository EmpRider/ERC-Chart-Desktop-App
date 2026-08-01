import type { WorkspaceAction } from "../src/workspace.js";

const validLayoutAction: WorkspaceAction = {
  type: "set-layout",
  tabId: "tab-1",
  layoutSize: 4,
};

const invalidLayoutAction: WorkspaceAction = {
  type: "set-layout",
  tabId: "tab-1",
  // @ts-expect-error Layout actions accept only the closed one-to-four domain.
  layoutSize: 5,
};

void validLayoutAction;
void invalidLayoutAction;
