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
  npmRebuild: false,
  electronFuses: electronFusePolicy,
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
  },
  nsis: {
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
