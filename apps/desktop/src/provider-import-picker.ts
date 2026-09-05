import path from "node:path";
import type { PluginPackageSource } from "@erc-chart/provider-runtime";

interface MessageBoxOptions {
  readonly type: "question";
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly buttons: string[];
  readonly defaultId: number;
  readonly cancelId: number;
  readonly noLink: boolean;
}

interface OpenDialogOptions {
  readonly title: string;
  readonly properties: ("openFile" | "openDirectory")[];
  readonly filters?: {
    readonly name: string;
    readonly extensions: string[];
  }[];
}

export interface ProviderImportDialog {
  readonly showMessageBox: (
    options: MessageBoxOptions,
  ) => Promise<{ readonly response: number }>;
  readonly showOpenDialog: (options: OpenDialogOptions) => Promise<{
    readonly canceled: boolean;
    readonly filePaths: readonly string[];
  }>;
}

export async function selectProviderImportSource(
  dialog: ProviderImportDialog,
): Promise<PluginPackageSource | null> {
  const mode = await dialog.showMessageBox({
    type: "question",
    title: "Import ERC Chart provider",
    message: "Choose the provider package format to import.",
    detail:
      "ZIP packages are the distributable format. Folder import remains available for local development.",
    buttons: ["ZIP package", "Provider folder", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });

  if (mode.response === 2) return null;

  if (mode.response === 0) {
    const selection = await dialog.showOpenDialog({
      title: "Import ERC Chart provider ZIP",
      properties: ["openFile"],
      filters: [
        {
          name: "ERC Chart provider packages",
          extensions: ["zip"],
        },
      ],
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || selectedPath === undefined) return null;
    if (path.extname(selectedPath).toLocaleLowerCase("en-US") !== ".zip") {
      throw new Error("Provider package must be a .zip file.");
    }
    return { kind: "zip", path: selectedPath };
  }

  if (mode.response === 1) {
    const selection = await dialog.showOpenDialog({
      title: "Import ERC Chart provider folder",
      properties: ["openDirectory"],
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || selectedPath === undefined) return null;
    return { kind: "folder", path: selectedPath };
  }

  return null;
}
