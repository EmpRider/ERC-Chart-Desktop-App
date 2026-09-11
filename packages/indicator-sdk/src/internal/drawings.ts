import {
  authoringFrame,
  type AuthoringFrame,
  type KernelSlot,
} from "../authoring-context.js";
import { sameDrawing } from "../drawing-equality.js";
import type { IndicatorOverlay } from "../index.js";
import type { CompilerCallsite } from "./callsite.js";

const MAX_DRAWINGS = 2_000;

interface FrameDrawingUsage {
  devBoxOccurrence: number;
  devSegmentOccurrence: number;
  readonly occurrences: Map<string, number>;
}

interface DrawingRegistryEntry {
  committed?: IndicatorOverlay;
  readonly controller: DrawingController;
}

export interface DrawingController {
  readonly id: string;
  readonly kind: IndicatorOverlay["kind"];
  current(): IndicatorOverlay | undefined;
  write(value: IndicatorOverlay): void;
  update(update: (current: IndicatorOverlay) => IndicatorOverlay): void;
  delete(): void;
}

const frameDrawingUsage = new WeakMap<AuthoringFrame, FrameDrawingUsage>();
const drawingRegistries = new WeakMap<
  KernelSlot[],
  Map<string, DrawingRegistryEntry>
>();
const drawingIds = new WeakMap<KernelSlot[], Map<string, string[]>>();

function drawingUsage(frame: AuthoringFrame): FrameDrawingUsage {
  let usage = frameDrawingUsage.get(frame);
  if (usage === undefined) {
    usage = {
      devBoxOccurrence: 0,
      devSegmentOccurrence: 0,
      occurrences: new Map(),
    };
    frameDrawingUsage.set(frame, usage);
  }
  return usage;
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
  let bySource = drawingIds.get(kernels);
  if (bySource === undefined) {
    bySource = new Map();
    drawingIds.set(kernels, bySource);
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
  callsite?: CompilerCallsite,
): string {
  const usage = drawingUsage(frame);
  if (callsite === undefined) {
    const occurrence =
      callee === "plot.box"
        ? usage.devBoxOccurrence++
        : usage.devSegmentOccurrence++;
    return cachedDrawingId(frame.kernels, `dev:${callee}`, occurrence);
  }
  const occurrence = usage.occurrences.get(callsite.id) ?? 0;
  usage.occurrences.set(callsite.id, occurrence + 1);
  return cachedDrawingId(frame.kernels, callsite.id, occurrence);
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

function writeDrawing(frame: AuthoringFrame, value: IndicatorOverlay): void {
  if (frame.discovery) return;
  frame.overlayUpdates.set(value.id, Object.freeze(value));
  if (frame.overlayUpdates.size > MAX_DRAWINGS)
    throw new RangeError("At most 2,000 drawing changes are allowed per bar.");
}

export function drawingController(
  kind: IndicatorOverlay["kind"],
  callee: "plot.box" | "plot.segment",
  callsite?: CompilerCallsite,
): DrawingController {
  const frame = authoringFrame();
  const id = nextDrawingId(frame, callee, callsite);
  const registry = drawingRegistry(frame.kernels);
  const existing = registry.get(id);
  if (existing !== undefined) {
    if (existing.controller.kind !== kind)
      throw new Error(
        `Drawing identity ${id} changed kind; rebuild the indicator package.`,
      );
    return existing.controller;
  }

  const controller: DrawingController = Object.freeze({
    id,
    kind,
    current(): IndicatorOverlay | undefined {
      const active = authoringFrame();
      if (active.discovery) return undefined;
      return pendingDrawing(active, id, entry);
    },
    write(value: IndicatorOverlay): void {
      const active = authoringFrame();
      if (value.id !== id || value.kind !== kind)
        throw new Error(
          "Drawing handles cannot change hidden identity or kind.",
        );
      const current = pendingDrawing(active, id, entry);
      if (current !== undefined && sameDrawing(current, value)) return;
      writeDrawing(active, value);
      if (active.phase === "finalized" && !active.discovery)
        entry.committed = Object.freeze(value);
    },
    update(update: (current: IndicatorOverlay) => IndicatorOverlay): void {
      const active = authoringFrame();
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
      if (active.discovery) return;
      if (pendingDrawing(active, id, entry) === undefined) return;
      active.overlayUpdates.set(id, null);
      if (active.overlayUpdates.size > MAX_DRAWINGS)
        throw new RangeError(
          "At most 2,000 drawing changes are allowed per bar.",
        );
      if (active.phase === "finalized") delete entry.committed;
    },
  });
  const entry: DrawingRegistryEntry = { controller };
  registry.set(id, entry);
  while (registry.size > MAX_DRAWINGS) {
    const oldest = registry.keys().next().value;
    if (oldest === undefined) break;
    const evicted = registry.get(oldest);
    if (evicted !== undefined) delete evicted.committed;
    registry.delete(oldest);
  }
  return controller;
}
