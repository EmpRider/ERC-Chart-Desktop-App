import type { IndicatorRuntimeSignalSource } from "@erc-chart/contracts";
import type { CompilerCallsite } from "./callsite.js";
import type { IndicatorSourceMetadata } from "./runtime-contracts.js";

export interface SignalDependency {
  readonly ready: boolean;
  readonly identities: readonly string[];
  readonly sources: readonly IndicatorRuntimeSignalSource[];
  readonly occurredAtMs?: number;
}

export interface SignalState {
  readonly committed: Set<string>;
  readonly order: string[];
}

export function createSignalState(): SignalState {
  return { committed: new Set(), order: [] };
}

export function resetSignalState(state: SignalState): void {
  state.committed.clear();
  state.order.length = 0;
}

function signalSourceIdentity(
  timeframeId: string,
  activeTimeframeId: string,
  openTimeMs: number,
): string {
  const value = JSON.stringify([timeframeId, activeTimeframeId, openTimeMs]);
  const bytes = new TextEncoder().encode(value);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += alphabet[first >> 2];
    encoded += alphabet[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined)
      encoded += alphabet[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    if (third !== undefined) encoded += alphabet[third & 0x3f];
  }
  return encoded;
}

export function sourceSignalDependency(
  timeframeId: string,
  openTimeMs: number | undefined,
  ready: boolean,
  metadata?: IndicatorSourceMetadata,
): SignalDependency {
  if (!ready || openTimeMs === undefined)
    return { ready: false, identities: [], sources: [] };
  const activeTimeframeId = metadata?.activeTimeframeId ?? timeframeId;
  const identity = signalSourceIdentity(
    timeframeId,
    activeTimeframeId,
    openTimeMs,
  );
  if (metadata === undefined)
    return {
      ready: true,
      identities: [identity],
      sources: [],
      occurredAtMs: openTimeMs,
    };
  return {
    ready: true,
    identities: [identity],
    occurredAtMs: openTimeMs,
    sources: [
      Object.freeze({
        timeframeId,
        activeTimeframeId,
        openTimeMs,
        generation: metadata.generation,
        revision: metadata.revision,
        provenance: metadata.provenance,
      }),
    ],
  };
}

export function recordSignalDependency(
  dependencies: Map<string, SignalDependency>,
  callsite: CompilerCallsite | undefined,
  dependency: SignalDependency,
): void {
  if (callsite !== undefined) dependencies.set(callsite.id, dependency);
}

export function resolveSignalDependencies(
  dependencies: ReadonlyMap<string, SignalDependency>,
  callsite: CompilerCallsite | undefined,
): SignalDependency {
  if (callsite === undefined || callsite.dependencies === undefined)
    return { ready: true, identities: [], sources: [] };
  const identities: string[] = [];
  const sources: IndicatorRuntimeSignalSource[] = [];
  const sourceIds = new Set<string>();
  let occurredAtMs: number | undefined;
  for (const dependencyId of callsite.dependencies) {
    const dependency = dependencies.get(dependencyId);
    if (dependency === undefined || !dependency.ready)
      return { ready: false, identities: [], sources: [] };
    identities.push(...dependency.identities);
    if (dependency.occurredAtMs !== undefined)
      occurredAtMs =
        occurredAtMs === undefined
          ? dependency.occurredAtMs
          : Math.max(occurredAtMs, dependency.occurredAtMs);
    for (const source of dependency.sources) {
      const id = signalSourceIdentity(
        source.timeframeId,
        source.activeTimeframeId,
        source.openTimeMs,
      );
      if (sourceIds.has(id)) continue;
      sourceIds.add(id);
      sources.push(source);
    }
  }
  return {
    ready: true,
    identities,
    sources,
    ...(occurredAtMs === undefined ? {} : { occurredAtMs }),
  };
}

export function signalEventKey(
  signalKey: string,
  identities: readonly string[],
  fallbackOpenTimeMs: number,
): string {
  const suffix =
    identities.length === 0 ? `${fallbackOpenTimeMs}` : identities.join(":");
  return `${signalKey}:${suffix}`;
}

export function signalAlreadyCommitted(
  state: SignalState,
  eventKey: string,
): boolean {
  return state.committed.has(eventKey);
}

export function commitSignalEvents(
  state: SignalState,
  eventKeys: readonly string[],
): void {
  for (const eventKey of eventKeys) {
    if (state.committed.has(eventKey)) continue;
    state.committed.add(eventKey);
    state.order.push(eventKey);
  }
  while (state.order.length > 10_000) {
    const oldest = state.order.shift();
    if (oldest !== undefined) state.committed.delete(oldest);
  }
}
