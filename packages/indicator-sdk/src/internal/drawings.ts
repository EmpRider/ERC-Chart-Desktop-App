import {
  authoringFrame,
  type AuthoringFrame,
  type KernelSlot,
} from "../authoring-context.js";
import { sameDrawing } from "../drawing-equality.js";
import type { IndicatorOverlay } from "../index.js";
import type { CompilerCallsite } from "./callsite.js";

const MAX_DRAWINGS = 2_000;
const devDrawingUsageError =
  "Uncompiled drawing calls must run in the same order on every bar; compile indicator packages before using conditional drawing calls.";

interface FrameDrawingUsage {
  devBoxOccurrence: number;
  devSegmentOccurrence: number;
  readonly devBoxSources: string[];
  readonly devSegmentSources: string[];
  lastCompilerCallsiteId?: string;
  lastCompilerOccurrence: number;
  readonly occurrences: Map<string, number>;
}

interface ExpectedDevDrawingUsage {
  boxCount?: number;
  segmentCount?: number;
  boxSources?: readonly string[];
  segmentSources?: readonly string[];
}

interface DrawingRegistryEntry {
  committed?: IndicatorOverlay;
  readonly controller: DrawingController;
}

export interface DrawingController {
  readonly id: string;
  readonly kind: IndicatorOverlay["kind"];
  write(value: IndicatorOverlay): void;
  update(update: (current: IndicatorOverlay) => IndicatorOverlay): void;
  delete(): void;
}

const frameDrawingUsage = new WeakMap<AuthoringFrame, FrameDrawingUsage>();
const buildingDrawingEntries = new WeakMap<
  AuthoringFrame,
  Map<string, DrawingRegistryEntry>
>();
const expectedDevDrawingUsage = new WeakMap<
  KernelSlot[],
  ExpectedDevDrawingUsage
>();
const drawingRegistries = new WeakMap<
  KernelSlot[],
  Map<string, DrawingRegistryEntry>
>();
const drawingIdCache = new WeakMap<KernelSlot[], Map<string, string[]>>();

function invalidDevDrawingUsage(): Error {
  return new Error(devDrawingUsageError);
}

function drawingUsage(frame: AuthoringFrame): FrameDrawingUsage {
  let usage = frameDrawingUsage.get(frame);
  if (usage === undefined) {
    usage = {
      devBoxOccurrence: 0,
      devSegmentOccurrence: 0,
      devBoxSources: [],
      devSegmentSources: [],
      lastCompilerOccurrence: 0,
      occurrences: new Map(),
    };
    frameDrawingUsage.set(frame, usage);
  }
  return usage;
}

function validateDevDrawingUsage(
  expected: ExpectedDevDrawingUsage,
  countKey: "boxCount" | "segmentCount",
  sourcesKey: "boxSources" | "segmentSources",
  actualSources: readonly string[],
): void {
  const actual = actualSources.length;
  const baseline = expected[countKey];
  if (baseline === undefined) expected[countKey] = Math.max(1, actual);
  else if (!(baseline <= 1 && actual <= 1) && baseline !== actual)
    throw invalidDevDrawingUsage();

  if (actual === 0) return;
  const baselineSources = expected[sourcesKey];
  if (baselineSources === undefined) {
    expected[sourcesKey] = Object.freeze([...actualSources]);
    return;
  }
  if (
    baselineSources.length !== actualSources.length ||
    baselineSources.some((source, index) => source !== actualSources[index])
  )
    throw invalidDevDrawingUsage();
}

function rollbackBuildingDrawingEntries(frame: AuthoringFrame): void {
  const entries = buildingDrawingEntries.get(frame);
  if (entries === undefined) return;
  const registry = drawingRegistries.get(frame.kernels);
  if (registry !== undefined) {
    for (const [id, entry] of entries) {
      if (registry.get(id) === entry) registry.delete(id);
    }
  }
  buildingDrawingEntries.delete(frame);
}

export function validateDrawingUsage(frame: AuthoringFrame): void {
  if (frame.phase === "building") rollbackBuildingDrawingEntries(frame);
  if (frame.discovery) return;
  let expected = expectedDevDrawingUsage.get(frame.kernels);
  if (expected === undefined) {
    expected = {};
    expectedDevDrawingUsage.set(frame.kernels, expected);
  }
  const usage = drawingUsage(frame);
  validateDevDrawingUsage(
    expected,
    "boxCount",
    "boxSources",
    usage.devBoxSources,
  );
  validateDevDrawingUsage(
    expected,
    "segmentCount",
    "segmentSources",
    usage.devSegmentSources,
  );
}

function drawingRegistry(
  kernels: KernelSlot[],
): Map<string, DrawingRegistryEntry> {
  let registry = drawingRegistries.get(kernels);
  if (registry === undefined) {
    registry = new Map();
    drawingRegistries.set(kernels, registry);
  }
  return registry;
}

function cachedDrawingId(
  kernels: KernelSlot[],
  sourceIdentity: string,
  occurrence: number,
): string {
  let bySource = drawingIdCache.get(kernels);
  if (bySource === undefined) {
    bySource = new Map();
    drawingIdCache.set(kernels, bySource);
  }
  let ids = bySource.get(sourceIdentity);
  if (ids === undefined) {
    ids = [];
    bySource.set(sourceIdentity, ids);
  }
  let id = ids[occurrence];
  if (id === undefined) {
    id = `${sourceIdentity}:${occurrence}`;
    ids[occurrence] = id;
  }
  return id;
}

function nextDrawingId(
  frame: AuthoringFrame,
  callee: "plot.box" | "plot.segment",
  callsite: CompilerCallsite | undefined,
  developmentSource: string | undefined,
): string {
  const usage = drawingUsage(frame);
  if (callsite === undefined) {
    if (developmentSource === undefined) throw invalidDevDrawingUsage();
    if (callee === "plot.box") {
      const occurrence = usage.devBoxOccurrence++;
      usage.devBoxSources[occurrence] = developmentSource;
      return cachedDrawingId(frame.kernels, `dev:${callee}`, occurrence);
    }
    const occurrence = usage.devSegmentOccurrence++;
    usage.devSegmentSources[occurrence] = developmentSource;
    return cachedDrawingId(frame.kernels, `dev:${callee}`, occurrence);
  }

  let occurrence: number;
  if (usage.lastCompilerCallsiteId === callsite.id) {
    occurrence = usage.lastCompilerOccurrence++;
  } else {
    if (usage.lastCompilerCallsiteId !== undefined)
      usage.occurrences.set(
        usage.lastCompilerCallsiteId,
        usage.lastCompilerOccurrence,
      );
    occurrence = usage.occurrences.get(callsite.id) ?? 0;
    usage.lastCompilerCallsiteId = callsite.id;
    usage.lastCompilerOccurrence = occurrence + 1;
  }
  return cachedDrawingId(frame.kernels, callsite.id, occurrence);
}

function developmentDrawingSource(
  stack: string | undefined,
): string | undefined {
  const source = stack?.split("\n")[3]?.trim();
  return source === undefined || source.length === 0 ? undefined : source;
}

function pendingDrawing(
  frame: AuthoringFrame,
  id: string,
  entry: DrawingRegistryEntry,
): IndicatorOverlay | undefined {
  if (frame.overlayUpdates.size === 0) return entry.committed;
  if (frame.overlayUpdates.has(id))
    return frame.overlayUpdates.get(id) ?? undefined;
  return entry.committed;
}

function assertDrawingChangeCapacity(frame: AuthoringFrame, id: string): void {
  if (
    !frame.overlayUpdates.has(id) &&
    frame.overlayUpdates.size >= MAX_DRAWINGS
  )
    throw new RangeError("At most 2,000 drawing changes are allowed per bar.");
}

function writeDrawing(frame: AuthoringFrame, value: IndicatorOverlay): void {
  if (frame.discovery) return;
  assertDrawingChangeCapacity(frame, value.id);
  frame.overlayUpdates.set(value.id, Object.freeze(value));
}

function assertHandleOwner(
  active: AuthoringFrame,
  ownerKernels: KernelSlot[],
  registry: Map<string, DrawingRegistryEntry>,
  id: string,
  controller: DrawingController,
): void {
  if (
    active.kernels !== ownerKernels ||
    registry.get(id)?.controller !== controller
  )
    throw new Error("Drawing handle is not active.");
}

function registerDrawingEntry(
  frame: AuthoringFrame,
  registry: Map<string, DrawingRegistryEntry>,
  id: string,
  entry: DrawingRegistryEntry,
): void {
  registry.set(id, entry);
  if (frame.phase === "building" && !frame.discovery) {
    let entries = buildingDrawingEntries.get(frame);
    if (entries === undefined) {
      entries = new Map();
      buildingDrawingEntries.set(frame, entries);
    }
    entries.set(id, entry);
    return;
  }
  while (registry.size > MAX_DRAWINGS) {
    const oldest = registry.keys().next().value;
    if (oldest === undefined) break;
    const evicted = registry.get(oldest);
    if (evicted !== undefined) delete evicted.committed;
    registry.delete(oldest);
  }
}

export function drawingController(
  kind: IndicatorOverlay["kind"],
  callee: "plot.box" | "plot.segment",
  callsite?: CompilerCallsite,
): DrawingController {
  const frame = authoringFrame();
  const ownerKernels = frame.kernels;
  const developmentSource =
    callsite === undefined
      ? developmentDrawingSource(new Error().stack)
      : undefined;
  const id = nextDrawingId(frame, callee, callsite, developmentSource);
  const registry = drawingRegistry(ownerKernels);
  const existing = registry.get(id);
  if (existing !== undefined) {
    if (existing.controller.kind !== kind)
      throw new Error(
        `Drawing identity ${id} changed kind; rebuild the indicator package.`,
      );
    return existing.controller;
  }

  let registered = false;
  const controller: DrawingController = Object.freeze({
    id,
    kind,
    write(value: IndicatorOverlay): void {
      const active = authoringFrame();
      if (active.kernels !== ownerKernels)
        throw new Error("Drawing handle is not active.");
      if (value.id !== id || value.kind !== kind)
        throw new Error(
          "Drawing handles cannot change hidden identity or kind.",
        );
      const current = pendingDrawing(active, id, entry);
      if (current !== undefined && sameDrawing(current, value)) return;
      writeDrawing(active, value);
      if (!registered) {
        registerDrawingEntry(active, registry, id, entry);
        registered = true;
      }
      if (active.phase === "finalized" && !active.discovery)
        entry.committed = Object.freeze(value);
    },
    update(update: (current: IndicatorOverlay) => IndicatorOverlay): void {
      const active = authoringFrame();
      assertHandleOwner(active, ownerKernels, registry, id, controller);
      if (active.discovery) return;
      const current = pendingDrawing(active, id, entry);
      if (current === undefined)
        throw new Error("Drawing handle is not active.");
      const next = update(current);
      if (next.id !== id || next.kind !== kind)
        throw new Error(
          "Drawing handles cannot change hidden identity or kind.",
        );
      if (sameDrawing(current, next)) return;
      writeDrawing(active, next);
      if (active.phase === "finalized") entry.committed = Object.freeze(next);
    },
    delete(): void {
      const active = authoringFrame();
      assertHandleOwner(active, ownerKernels, registry, id, controller);
      if (active.discovery) return;
      if (pendingDrawing(active, id, entry) === undefined) return;
      assertDrawingChangeCapacity(active, id);
      active.overlayUpdates.set(id, null);
      if (active.phase === "finalized") delete entry.committed;
    },
  });
  const entry: DrawingRegistryEntry = { controller };
  return controller;
}
