import {
  authoringFrame,
  type AuthoringFrame,
  type KernelSlot,
} from "../authoring-context.js";
import type { IndicatorOverlay } from "../index.js";
import type { CompilerCallsite } from "./callsite.js";

const MAX_DRAWINGS = 2_000;

interface FrameDrawingUsage {
  readonly occurrences: Map<string, number>;
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
const drawingRegistries = new WeakMap<
  KernelSlot[],
  Map<string, DrawingRegistryEntry>
>();

function drawingUsage(frame: AuthoringFrame): FrameDrawingUsage {
  let usage = frameDrawingUsage.get(frame);
  if (usage === undefined) {
    usage = { occurrences: new Map() };
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

function nextDrawingId(
  frame: AuthoringFrame,
  callee: "plot.box" | "plot.segment",
  callsite?: CompilerCallsite,
): string {
  const usage = drawingUsage(frame);
  const sourceIdentity = callsite?.id ?? `dev:${callee}`;
  const occurrence = usage.occurrences.get(sourceIdentity) ?? 0;
  usage.occurrences.set(sourceIdentity, occurrence + 1);
  return `${sourceIdentity}:${occurrence}`;
}

function pendingDrawing(
  frame: AuthoringFrame,
  id: string,
  entry: DrawingRegistryEntry,
): IndicatorOverlay | undefined {
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
    write(value: IndicatorOverlay): void {
      const active = authoringFrame();
      if (value.id !== id || value.kind !== kind)
        throw new Error(
          "Drawing handles cannot change hidden identity or kind.",
        );
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
