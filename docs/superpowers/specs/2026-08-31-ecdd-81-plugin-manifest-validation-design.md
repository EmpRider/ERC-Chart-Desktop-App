# ECDD-81 Plugin Manifest Validation Design

Jira: [ECDD-81](https://erc-chart.atlassian.net/browse/ECDD-81)

Parent: [ECDD-79](https://erc-chart.atlassian.net/browse/ECDD-79)

## Scope

Add the provider-neutral and indicator-neutral plugin manifest v1 contract to `@erc-chart/contracts`. Export a JSON Schema artifact, a typed runtime manifest, and a validator that accepts untrusted parsed JSON only when it matches the same closed contract.

ZIP extraction, path canonicalization, file hashing, signature verification, installation, activation, permission approval, and plugin loading remain outside ECDD-81.

## Manifest v1

A valid `plugin.json` contains only:

- `manifestVersion`: exact current manifest contract version;
- `kind`: `provider` or `indicator`;
- `id`: lowercase dotted or hyphenated package identifier;
- `name`: bounded non-empty display name;
- `version`: strict SemVer without build metadata;
- `hostCompatibility`: positive safe integer minimum/maximum host API versions with minimum not greater than maximum;
- `entry`: package-relative precompiled `.js` or `.mjs` ESM path;
- `permissions`: dense, unique, sorted stable identifiers;
- `capabilities`: dense, unique, sorted stable identifiers;
- `integrity`: a non-empty object mapping normalized package-relative file paths to lowercase `sha256:` digests.

The schema rejects unknown fields. Runtime validation additionally enforces constraints JSON Schema cannot express simply: current manifest version, ordered compatibility bounds, duplicate-free sorted declarations, and prototype-safe plain JSON objects.

## Public API

`@erc-chart/contracts` exports:

- `PluginManifest` and `PluginManifestIntegrity` types;
- `pluginManifestSchema`, a dependency-free JSON Schema 2020-12 object;
- `inspectPluginManifest(value, currentHostApiVersion?)`, returning a stable report with field paths;
- `isPluginManifest(value, currentHostApiVersion?)`, a type predicate.

Validation reports use stable codes for malformed manifests, unsupported manifest versions, and incompatible host API ranges. Messages never echo untrusted values.

## Security boundaries

The validator rejects arrays with holes or extra properties, non-plain objects, symbol/accessor properties, inherited fields, unsafe numbers, unknown fields, traversal/absolute entry and integrity paths, backslashes, duplicate declarations, malformed digests, and incompatible host ranges. It validates declarations only; later installer tasks prove files exist and hashes match.

## Verification

Tests cover the minimal valid provider and indicator manifests, schema/runtime agreement for representative invalid values, unknown fields, malformed paths and hashes, duplicate declarations, unsupported versions, incompatible host ranges, prototype/accessor objects, and compile-time narrowing. Existing format, lint, typecheck, unit, integration, and build gates remain green.
