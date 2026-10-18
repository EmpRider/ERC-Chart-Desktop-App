import { electronFusePolicy } from "../../packages/electron-main/dist/index.js";
import { applicationVersion, productName } from "./packaging-contract.mjs";

export default {
  appId: "com.ercchart.desktop",
  productName,
  executableName: productName,
  electronVersion: "44.0.0",
  artifactName: "ERC-Chart-Setup-${version}.${ext}",
  directories: {
    app: "out/package-app",
    output: "release",
  },
  files: ["**/*"],
  extraMetadata: {
    version: applicationVersion,
  },
  asar: true,
  asarUnpack: [
    "packages/data-service/dist/utility-entry.js",
    "packages/provider-runtime/dist/utility-entry.js",
    "packages/provider-sdk/dist/index.js",
  ],
  npmRebuild: false,
  electronFuses: electronFusePolicy,
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
  },
  nsis: {
    include: "tools/packaging/installer.nsh",
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
    runAfterFinish: false,
    differentialPackage: false,
    deleteAppDataOnUninstall: false,
  },
  publish: null,
};
