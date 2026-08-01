# ECDD-58 Security Hardening Design

## Scope

ECDD-58 closes the remaining desktop-shell trust boundaries without adding user-facing features:

- a strict renderer Content Security Policy,
- denial of renderer navigation and child-window creation,
- validation of every IPC sender before returning privileged data, and
- a single package-time Electron fuse policy for ECDD-62 to apply.

The custom protocol itself remains owned by ECDD-57. Shell visuals, layout controls, multi-instance proof, and installer generation remain in ECDD-59 through ECDD-62.

## Renderer policy

The static entry document declares a CSP before loading any resource:

`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`

The current renderer uses only same-origin script and CSS. It has no network requirement, inline script, eval, forms, plugins, or remote fonts. The policy therefore fails closed without allowances that a future feature might need.

## Navigation policy

Each BrowserWindow installs policy before its first load:

- `setWindowOpenHandler` always returns `deny`.
- `will-navigate` permits only the canonical `erc-app://app/index.html` entry URL and prevents every other top-level navigation.

The URL decision is implemented as a pure exported predicate so malformed URLs, alternate hosts, credentials, ports, paths, queries, fragments, and external schemes have deterministic unit coverage. Resource requests continue through the ECDD-57 protocol resolver and are not treated as document navigation.

## IPC sender policy

The runtime-info handler receives an immutable sender description captured synchronously from Electron's `event.senderFrame`. It returns data only when the sender is the main frame at the canonical renderer entry URL. Missing frames, subframes, malformed URLs, and any other scheme/host/path are rejected with a fixed safe error.

The application package owns the trust decision; the Electron adapter only translates Electron objects into the narrow sender description. This keeps Electron-specific types out of the core package and makes unauthorized IPC behavior directly testable.

## Fuse policy

ECDD-58 exports and tests one immutable policy whose keys map directly to electron-builder's `electronFuses` configuration. ECDD-62 must consume this policy when it introduces packaging:

- disable `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments`, and `grantFileProtocolExtraPrivileges`;
- enable `enableCookieEncryption`, `enableEmbeddedAsarIntegrityValidation`, and `onlyLoadAppFromAsar`;
- leave `loadBrowserProcessSpecificV8Snapshot` disabled.

`runAsNode` is safe to disable because the application uses Electron `utilityProcess`, not `child_process.fork`. ASAR integrity and ASAR-only loading become effective when ECDD-62 creates the packaged application.

## Failure behavior and verification

Security denials do not open external URLs and do not expose private values. Unauthorized IPC rejects with a constant message. Tests cover the positive canonical case and negative malformed, external, subframe, and alternate local cases. The existing sandbox-enabled Electron smoke must still load the renderer under the CSP.

