import { rendererEntryUrl } from "./protocol.js";

export const rendererContentSecurityPolicy =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export interface DesktopIpcSender {
  readonly url: string;
  readonly isMainFrame: boolean;
}

export function isTrustedRendererDocument(url: string): boolean {
  try {
    const candidate = new URL(url);
    const expected = new URL(rendererEntryUrl);
    return (
      candidate.href === expected.href &&
      candidate.protocol === expected.protocol &&
      candidate.hostname === expected.hostname &&
      candidate.port === "" &&
      candidate.username === "" &&
      candidate.password === "" &&
      candidate.pathname === expected.pathname &&
      candidate.search === "" &&
      candidate.hash === ""
    );
  } catch {
    return false;
  }
}

export function assertTrustedIpcSender(
  sender: DesktopIpcSender | undefined,
): asserts sender is DesktopIpcSender {
  if (
    sender === undefined ||
    !sender.isMainFrame ||
    !isTrustedRendererDocument(sender.url)
  ) {
    throw new Error("Unauthorized IPC sender.");
  }
}

export interface ElectronFusePolicy {
  readonly runAsNode: boolean;
  readonly enableCookieEncryption: boolean;
  readonly enableNodeOptionsEnvironmentVariable: boolean;
  readonly enableNodeCliInspectArguments: boolean;
  readonly enableEmbeddedAsarIntegrityValidation: boolean;
  readonly onlyLoadAppFromAsar: boolean;
  readonly loadBrowserProcessSpecificV8Snapshot: boolean;
  readonly grantFileProtocolExtraPrivileges: boolean;
}

export const electronFusePolicy: Readonly<ElectronFusePolicy> = Object.freeze({
  runAsNode: false,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  loadBrowserProcessSpecificV8Snapshot: false,
  grantFileProtocolExtraPrivileges: false,
});
