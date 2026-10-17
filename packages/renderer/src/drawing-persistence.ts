import type { Chart, OverlayCreate } from "klinecharts";

export interface DrawingSnapshot {
  readonly overlays: readonly OverlayCreate[];
}

export interface DrawingHistory {
  readonly undo: () => DrawingSnapshot | undefined;
  readonly redo: () => DrawingSnapshot | undefined;
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;
  readonly push: (snapshot: DrawingSnapshot) => void;
  readonly current: () => DrawingSnapshot;
  readonly clear: () => void;
}

const maxHistoryDepth = 50;

export function createDrawingHistory(
  initial: DrawingSnapshot = { overlays: [] },
): DrawingHistory {
  const past: DrawingSnapshot[] = [];
  const future: DrawingSnapshot[] = [];
  let present: DrawingSnapshot = initial;

  return {
    undo(): DrawingSnapshot | undefined {
      const previous = past.pop();
      if (previous === undefined) return undefined;
      future.push(present);
      present = previous;
      return present;
    },
    redo(): DrawingSnapshot | undefined {
      const next = future.pop();
      if (next === undefined) return undefined;
      past.push(present);
      present = next;
      return present;
    },
    canUndo(): boolean {
      return past.length > 0;
    },
    canRedo(): boolean {
      return future.length > 0;
    },
    push(snapshot: DrawingSnapshot): void {
      past.push(present);
      if (past.length > maxHistoryDepth) past.shift();
      future.length = 0;
      present = snapshot;
    },
    current(): DrawingSnapshot {
      return present;
    },
    clear(): void {
      past.length = 0;
      future.length = 0;
      present = { overlays: [] };
    },
  };
}

type OverlayChart = Pick<
  Chart,
  "getOverlays" | "createOverlay" | "removeOverlay"
>;

export function captureDrawingSnapshot(chart: OverlayChart): DrawingSnapshot {
  const overlays = chart.getOverlays();
  return {
    overlays: overlays.map((overlay) => ({
      id: overlay.id,
      name: overlay.name,
      points: overlay.points ?? [],
      styles: overlay.styles,
      lock: overlay.lock,
      visible: overlay.visible,
      mode: overlay.mode,
      extendData: overlay.extendData,
    })),
  };
}

export function restoreDrawingSnapshot(
  chart: OverlayChart,
  snapshot: DrawingSnapshot,
): void {
  chart.removeOverlay();
  for (const overlay of snapshot.overlays) {
    chart.createOverlay(overlay);
  }
}

export function serializeDrawingSnapshot(snapshot: DrawingSnapshot): string {
  return JSON.stringify(snapshot);
}

export function deserializeDrawingSnapshot(raw: string): DrawingSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { overlays: [] };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).overlays)
  ) {
    return { overlays: [] };
  }
  return parsed as DrawingSnapshot;
}
