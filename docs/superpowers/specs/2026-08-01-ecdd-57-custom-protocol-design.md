# ECDD-57 Custom Protocol Design

## Goal

Serve the desktop renderer from the privileged `erc-app://` scheme without widening the renderer privilege boundary or implementing ECDD-58 security policy early.

## Approved scope

- Register `erc-app` as a standard, secure, fetch-capable scheme before Electron becomes ready.
- Install one handler after readiness for the fixed `app` host.
- Resolve renderer requests only inside the built runtime asset directory.
- Load the initial renderer with `erc-app://app/index.html`.
- Remove the handler during shutdown and partial-startup cleanup.
- Keep CSP, navigation denial, IPC sender validation, and Electron fuses in ECDD-58.

## Architecture

The Electron-independent package owns URL and filesystem containment policy so it can be tested without launching Electron. The desktop composition layer adapts that policy to Electron's `protocol.handle`, `net.fetch`, and `protocol.unhandle` APIs. `startDesktopApplication` owns protocol lifecycle alongside the IPC handler and data utility.

The resolver accepts only the exact `erc-app:` scheme and `app` host. It decodes the pathname, rejects malformed encodings, NUL bytes, backslashes, and any path that resolves outside the renderer root, then returns a `file:` URL. Query strings and fragments never influence filesystem resolution.

## Failure behavior

- Invalid or out-of-root URLs return an explicit not-found response.
- Duplicate or failed protocol registration aborts startup using the existing redacted startup error.
- Failed startup and normal shutdown both remove any installed handler.
- A renderer load failure destroys the hidden partial window as before.

## Testing

- Unit tests cover valid nested assets, host/scheme rejection, malformed encoding, traversal, and separator attacks.
- Application lifecycle tests prove registration precedes URL loading and cleanup is idempotent.
- Desktop path tests prove the fixed entry URL and runtime root are working-directory independent.
- Runtime build and Electron smoke tests prove CSS and module assets load through the protocol.

## Alternatives rejected

- A permissive file proxy was rejected because it could expose files outside the renderer build.
- A fixed three-file in-memory map was rejected because React production builds will introduce hashed chunk names in ECDD-59.
