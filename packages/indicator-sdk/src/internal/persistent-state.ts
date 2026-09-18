import {
  authoringFrame,
  useKernel,
  type AuthoringFrame,
  type KernelSlot,
} from "../authoring-context.js";
import {
  assertBoundedSeriesCollectionGroup,
  assertBoundedSeriesCollections,
  cloneSeriesState,
} from "../series.js";
import { readCompilerCallsite } from "./callsite.js";
import type { CompilerCallsite } from "./callsite.js";

interface PersistentStateSlot<T> {
  initialized: boolean;
  committed: T | undefined;
}

interface PendingPersistentState<T> {
  readonly state: PersistentStateSlot<T>;
  readonly readCurrent: () => T;
}

interface ScalarSeriesState {
  readonly committed: number[];
}

interface PendingScalarSeries {
  readonly state: ScalarSeriesState;
  readonly readCurrent: () => number;
}

const pendingPersistentState = new WeakMap<
  AuthoringFrame,
  PendingPersistentState<unknown>[]
>();
const persistentStateScopes = new WeakMap<AuthoringFrame, string[]>();
const pendingScalarSeries = new WeakMap<
  AuthoringFrame,
  PendingScalarSeries[]
>();
const scalarSeriesStores = new WeakMap<
  KernelSlot[],
  Map<string, ScalarSeriesState>
>();

function scopedRuntimeIdentity(
  frame: AuthoringFrame,
  callsite: CompilerCallsite | undefined,
): string | undefined {
  if (callsite === undefined) return undefined;
  const scope = persistentStateScopes.get(frame);
  return scope === undefined || scope.length === 0
    ? callsite.id
    : `${callsite.id}:${scope.join(":")}`;
}

function scalarSeriesStore(
  kernels: KernelSlot[],
): Map<string, ScalarSeriesState> {
  let store = scalarSeriesStores.get(kernels);
  if (store === undefined) {
    store = new Map();
    scalarSeriesStores.set(kernels, store);
  }
  return store;
}

function normalizeHistoryOffset(barsBack: number): number {
  if (!Number.isSafeInteger(barsBack) || barsBack < 0)
    throw new RangeError("History offset must be a non-negative safe integer.");
  return barsBack;
}

/** Compiler-only entry point for Pine-style persistent `var` declarations. */
export function persistentVar<T>(
  initialize: () => T,
  readCurrent: () => T,
  hiddenCallsite?: unknown,
): T {
  const frame = authoringFrame();
  const callsite = readCompilerCallsite(
    hiddenCallsite,
    "state",
    "persistent-var",
  );
  const runtimeIdentity = scopedRuntimeIdentity(frame, callsite);
  const state = useKernel<PersistentStateSlot<T>>(
    "persistent-var",
    () => ({ initialized: false, committed: undefined }),
    callsite,
    runtimeIdentity,
  );
  let value: T;
  if (state.initialized) {
    value = cloneSeriesState(state.committed as T);
  } else {
    const initial = initialize();
    assertBoundedSeriesCollections(initial);
    value = cloneSeriesState(initial);
  }
  let pending = pendingPersistentState.get(frame);
  if (pending === undefined) {
    pending = [];
    pendingPersistentState.set(frame, pending);
  }
  pending.push({
    state: state as PersistentStateSlot<unknown>,
    readCurrent: readCurrent as () => unknown,
  });
  return value;
}

/** Compiler-only entry point for mutable scalar values that participate in history. */
export function scalarSeries(
  initial: number,
  readCurrent: () => number,
  hiddenCallsite?: unknown,
): number {
  const frame = authoringFrame();
  const callsite = readCompilerCallsite(
    hiddenCallsite,
    "state",
    "scalar-series",
  );
  const runtimeIdentity = scopedRuntimeIdentity(frame, callsite);
  if (runtimeIdentity === undefined)
    throw new TypeError(
      "Scalar recurrence requires compiler-generated state identity.",
    );
  if (typeof initial !== "number")
    throw new TypeError("Scalar recurrence values must be numeric.");
  const state = useKernel<ScalarSeriesState>(
    "scalar-series",
    () => ({ committed: [] }),
    callsite,
    runtimeIdentity,
  );
  scalarSeriesStore(frame.kernels).set(runtimeIdentity, state);
  let pending = pendingScalarSeries.get(frame);
  if (pending === undefined) {
    pending = [];
    pendingScalarSeries.set(frame, pending);
  }
  pending.push({ state, readCurrent });
  return initial;
}

/** Compiler-only history reader paired with scalarSeries(). */
export function scalarSeriesHistory(
  current: number,
  barsBack: number,
  hiddenCallsite?: unknown,
): number {
  const frame = authoringFrame();
  const callsite = readCompilerCallsite(
    hiddenCallsite,
    "state",
    "scalar-series",
  );
  const runtimeIdentity = scopedRuntimeIdentity(frame, callsite);
  if (runtimeIdentity === undefined)
    throw new TypeError(
      "Scalar recurrence requires compiler-generated state identity.",
    );
  const offset = normalizeHistoryOffset(barsBack);
  if (offset === 0) return current;
  const state = scalarSeriesStore(frame.kernels).get(runtimeIdentity);
  if (state === undefined)
    throw new Error("Scalar recurrence state was read before initialization.");
  return state.committed.at(-offset) ?? Number.NaN;
}

/** Compiler-only wrapper that scopes stateful helper calls by authored invocation site. */
export function withPersistentStateScope<T>(
  hiddenCallsite: unknown,
  run: () => T,
): T {
  const frame = authoringFrame();
  const callsite = readCompilerCallsite(
    hiddenCallsite,
    "state",
    "persistent-scope",
  );
  if (callsite === undefined) return run();
  let scopes = persistentStateScopes.get(frame);
  if (scopes === undefined) {
    scopes = [];
    persistentStateScopes.set(frame, scopes);
  }
  scopes.push(callsite.id);
  try {
    return run();
  } finally {
    scopes.pop();
    if (scopes.length === 0) persistentStateScopes.delete(frame);
  }
}

/** Finalizes compiler-owned persistent state only after a successful bar evaluation. */
export function finalizePersistentState(frame: AuthoringFrame): void {
  const pending = pendingPersistentState.get(frame);
  if (pending !== undefined) {
    pendingPersistentState.delete(frame);
    const values = pending.map((entry) => entry.readCurrent());
    assertBoundedSeriesCollectionGroup(values);
    const committedValues =
      frame.phase === "finalized"
        ? values.map((value) => cloneSeriesState(value))
        : undefined;
    for (const [index, entry] of pending.entries()) {
      if (committedValues !== undefined) {
        entry.state.committed = committedValues[index];
        entry.state.initialized = true;
      }
    }
  }
  const scalarPending = pendingScalarSeries.get(frame);
  if (scalarPending === undefined) return;
  pendingScalarSeries.delete(frame);
  for (const entry of scalarPending) {
    const value = entry.readCurrent();
    if (typeof value !== "number")
      throw new TypeError("Scalar recurrence values must remain numeric.");
    if (frame.phase === "finalized") entry.state.committed.push(value);
  }
}
