import assert from "node:assert/strict";
import test from "node:test";
import { selectProviderImportSource } from "../dist/provider-import-picker.js";

function createDialog({ response, selection }) {
  const calls = [];
  return {
    calls,
    dialog: {
      async showMessageBox(options) {
        calls.push(["message", options]);
        return { response };
      },
      async showOpenDialog(options) {
        calls.push(["open", options]);
        return selection;
      },
    },
  };
}

test("selects a distributable provider ZIP", async () => {
  const fixture = createDialog({
    response: 0,
    selection: {
      canceled: false,
      filePaths: ["C:\\providers\\binomo-provider.ZIP"],
    },
  });

  const source = await selectProviderImportSource(fixture.dialog);

  assert.deepEqual(source, {
    kind: "zip",
    path: "C:\\providers\\binomo-provider.ZIP",
  });
  assert.deepEqual(fixture.calls[1][1].properties, ["openFile"]);
  assert.deepEqual(fixture.calls[1][1].filters, [
    { name: "ERC Chart provider packages", extensions: ["zip"] },
  ]);
});

test("keeps provider folder import available for development", async () => {
  const fixture = createDialog({
    response: 1,
    selection: {
      canceled: false,
      filePaths: ["C:\\providers\\binomo-provider"],
    },
  });

  const source = await selectProviderImportSource(fixture.dialog);

  assert.deepEqual(source, {
    kind: "folder",
    path: "C:\\providers\\binomo-provider",
  });
  assert.deepEqual(fixture.calls[1][1].properties, ["openDirectory"]);
});

test("returns null when import selection is canceled", async () => {
  const fixture = createDialog({
    response: 2,
    selection: { canceled: true, filePaths: [] },
  });

  assert.equal(await selectProviderImportSource(fixture.dialog), null);
  assert.equal(fixture.calls.length, 1);
});

test("rejects a non-ZIP file selected through the ZIP path", async () => {
  const fixture = createDialog({
    response: 0,
    selection: {
      canceled: false,
      filePaths: ["C:\\providers\\binomo-provider.js"],
    },
  });

  await assert.rejects(
    selectProviderImportSource(fixture.dialog),
    /must be a \.zip file/u,
  );
});
