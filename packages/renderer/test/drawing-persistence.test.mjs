import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
createDrawingHistory,
captureDrawingSnapshot,
restoreDrawingSnapshot,
serializeDrawingSnapshot,
deserializeDrawingSnapshot,
} from "../dist/drawing-persistence.js";
describe("createDrawingHistory", () => {
it("starts with empty snapshot and cannot undo/redo", () => {
const history = createDrawingHistory();
assert.equal(history.canUndo(), false);
assert.equal(history.canRedo(), false);
assert.deepEqual(history.current(), { overlays: [] });
});
it("push enables undo, disables redo", () => {
const history = createDrawingHistory();
history.push({ overlays: [{ id: "1", name: "straightLine", points: [] }] });
assert.equal(history.canUndo(), true);
assert.equal(history.canRedo(), false);
});
it("undo restores previous and enables redo", () => {
const history = createDrawingHistory();
history.push({ overlays: [{ id: "1", name: "straightLine", points: [] }] });
const restored = history.undo();
assert.deepEqual(restored, { overlays: [] });
assert.equal(history.canUndo(), false);
assert.equal(history.canRedo(), true);
});
it("redo restores next and disables redo after", () => {
const history = createDrawingHistory();
history.push({ overlays: [{ id: "1", name: "straightLine", points: [] }] });
history.undo();
const redone = history.redo();
assert.deepEqual(redone, { overlays: [{ id: "1", name: "straightLine", points: [] }] });
assert.equal(history.canRedo(), false);
});
it("push after undo clears redo stack", () => {
const history = createDrawingHistory();
history.push({ overlays: [{ id: "1", name: "straightLine", points: [] }] });
history.undo();
history.push({ overlays: [{ id: "2", name: "brush", points: [] }] });
assert.equal(history.canRedo(), false);
});
it("respects maxHistoryDepth of 50", () => {
const history = createDrawingHistory();
for (let i = 0; i < 60; i++) {
history.push({ overlays: [{ id: String(i), name: "straightLine", points: [] }] });
}
let undoCount = 0;
while (history.canUndo()) {
history.undo();
undoCount++;
}
assert.equal(undoCount, 50);
});
it("clear resets to empty", () => {
const history = createDrawingHistory();
history.push({ overlays: [{ id: "1", name: "straightLine", points: [] }] });
history.clear();
assert.equal(history.canUndo(), false);
assert.deepEqual(history.current(), { overlays: [] });
});
});
describe("serializeDrawingSnapshot / deserializeDrawingSnapshot", () => {
it("round-trips a snapshot", () => {
const snapshot = {
overlays: [
{ id: "abc", name: "fibonacciLine", points: [{ x: 1, y: 2 }], styles: {}, lock: false, visible: true },
],
};
const raw = serializeDrawingSnapshot(snapshot);
const restored = deserializeDrawingSnapshot(raw);
assert.deepEqual(restored, snapshot);
});
it("returns empty overlays for invalid JSON", () => {
assert.deepEqual(deserializeDrawingSnapshot("not json"), { overlays: [] });
});
it("returns empty overlays for missing overlays array", () => {
assert.deepEqual(deserializeDrawingSnapshot('{"foo":"bar"}'), { overlays: [] });
});
});
describe("captureDrawingSnapshot / restoreDrawingSnapshot", () => {
it("captures overlays from chart mock", () => {
const mockChart = {
getOverlays: () => [
{ id: "o1", name: "straightLine", points: [{ x: 0, y: 100 }], styles: undefined, lock: false, visible: true, mode: "normal", extendData: undefined },
],
createOverlay: () => {},
removeOverlay: () => {},
};
const snapshot = captureDrawingSnapshot(mockChart);
assert.equal(snapshot.overlays.length, 1);
assert.equal(snapshot.overlays[0].name, "straightLine");
});
it("restores overlays to chart mock", () => {
const created = [];
const removed = [];
const mockChart = {
getOverlays: () => [],
createOverlay: (o) => { created.push(o); },
removeOverlay: () => { removed.push(true); },
};
const snapshot = { overlays: [{ id: "r1", name: "brush", points: [] }] };
restoreDrawingSnapshot(mockChart, snapshot);
assert.equal(removed.length, 1);
assert.equal(created.length, 1);
assert.equal(created[0].name, "brush");
});
});