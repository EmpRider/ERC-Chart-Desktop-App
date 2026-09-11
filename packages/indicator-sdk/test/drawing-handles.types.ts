import { plot, signal } from "../src/index.js";

export const box = plot.box({
  left: 1_700_000_000_000,
  right: 1_700_000_060_000,
  top: 101,
  bottom: 99,
  color: "#ffcc00",
});
box.set({ right: 1_700_000_120_000, top: 102 });
box.delete();

export const segment = plot.segment({
  left: 1_700_000_000_000,
  right: 1_700_000_060_000,
  startValue: 100,
  endValue: 101,
  color: "#ffffff",
  width: 2,
  style: "solid",
});
segment.set({ right: 1_700_000_120_000, endValue: 102 });
segment.delete();

signal(true, "long", { confidence: 0.75 });

// @ts-expect-error signal persistence identity is compiler/runtime owned in SDK v2
signal(true, "long", { id: "manual-signal" });

// @ts-expect-error drawing deletion uses the handle, never an author-owned persistence ID
plot.remove("manual-drawing");

// @ts-expect-error reconciliation scopes are internal; authors use persistent drawing handles
plot.drawings("manual-scope", () => undefined);
