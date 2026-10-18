# Provider SDK examples

Epic 3 includes two compile-time and runtime examples under
`packages/provider-examples`: a tick-producing provider and a candle-producing
provider. Both depend only on `@erc-chart/provider-sdk` and deliberately avoid
renderer, storage, indicator, Electron, Node, database, and private runtime
imports.

## Provider package shape

A provider package presented to the desktop importer contains a `plugin.json`
manifest and a compiled JavaScript entry file. A minimal development package
looks like this:

```text
example-provider/
  plugin.json
  dist/
    index.js
```

The manifest identifies the provider, its version and public API compatibility,
the compiled entry point, requested permissions, and SHA-256 integrity metadata
covering every package file except `plugin.json` itself. TypeScript is an
authoring format; the imported package contains the compiled JavaScript entry.

Provider source imports authoring types and helpers from one dependency:

```ts
import {
  defineProvider,
  hostApiVersion,
  providerSdkVersion,
  type InstrumentId,
  type ProviderId,
  type TimeframeId,
} from "@erc-chart/provider-sdk";
```

## Profile configuration

`ProviderDefinition.config` declares non-secret settings and secret credential
keys. A profile persists only validated non-secret values. Secret values remain
in Windows Credential Manager and are requested at runtime through the provider
credential lease; they are not written into the package, manifest, profile,
workspace, command line, or environment.

Configuration fields marked `requiresReconnect` trigger the controlled
reconnect lifecycle. Other changed fields use the controlled restart lifecycle.
The host invalidates and restores downstream demand around those transitions.

## Development import path

To exercise a local provider during development:

1. Compile the TypeScript provider to the manifest entry path.
2. Generate SHA-256 integrity metadata for every packaged content file.
3. Stage the package in Developer Mode. Unsigned packages are allowed only in
   Developer Mode; Production Mode still requires a trusted signature.
4. Review the manifest permissions in the application permission-review UI.
5. Install and register the approved package, then activate the selected
   version.
6. Start a provider profile. The utility runtime loads the installed entry,
   validates the public `ProviderDefinition`, creates the adapter with brokered
   host services, and calls `connect()`.
7. Use the provider contract test kit in `@erc-chart/testing` to validate the
   adapter's discovery, history, live subscription, unsubscribe, and disconnect
   behavior.

The Epic 3 provider-import acceptance test runs this complete path for both
examples and verifies cleanup when a provider fails during startup.
