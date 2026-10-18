filepath = "packages/renderer/src/provider-chart.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add Rectangle tool
old_tools = '{ name: "brush", label: "Brush", glyph: "✎" },\n{ name: "simpleAnnotation"'
new_tools = '{ name: "brush", label: "Brush", glyph: "✎" },\n{ name: "rect", label: "Rectangle", glyph: "▭" },\n{ name: "simpleAnnotation"'
if old_tools in content:
    content = content.replace(old_tools, new_tools)
    print("PATCH 1 OK: added rect tool")
elif "rect" in content and "Rectangle" in content:
    print("PATCH 1 SKIP: already present")
else:
    print("PATCH 1 FAIL: pattern not found")

# 2. Add overlay selection state
old_state = "const [canRedoDrawing, setCanRedoDrawing] = useState(false);"
new_state = """const [canRedoDrawing, setCanRedoDrawing] = useState(false);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | undefined>(undefined);
  const [overlayColor, setOverlayColor] = useState("#2196f3");
  const [overlayWidth, setOverlayWidth] = useState(1);"""
if old_state in content and "selectedOverlayId" not in content:
    content = content.replace(old_state, new_state, 1)
    print("PATCH 2 OK: added overlay selection state")
elif "selectedOverlayId" in content:
    print("PATCH 2 SKIP: already present")
else:
    print("PATCH 2 FAIL: canRedoDrawing line not found")

# 3. Replace clear button + </aside> with restyle controls
old_clear = """onClick={() => chartInstance.current?.removeOverlay()}
              >
                <span aria-hidden="true">×</span>
              </button>
            </aside>"""
new_clear = """onClick={() => {
                const chart = chartInstance.current;
                if (chart === undefined) return;
                chart.removeOverlay();
                setSelectedOverlayId(undefined);
                const snapshot = captureDrawingSnapshot(chart);
                drawingHistory.current.push(snapshot);
                setCanUndoDrawing(drawingHistory.current.canUndo());
                setCanRedoDrawing(drawingHistory.current.canRedo());
              }}
              >
                <span aria-hidden="true">×</span>
              </button>
              {selectedOverlayId !== undefined && (
                <div className="provider-drawing-restyle" role="group" aria-label="Restyle selected overlay">
                  <label htmlFor="overlay-color-picker" className="provider-drawing-restyle-label">
                    Color
                    <input
                      id="overlay-color-picker"
                      type="color"
                      value={overlayColor}
                      onChange={(e) => {
                        const chart = chartInstance.current;
                        if (chart === undefined || selectedOverlayId === undefined) return;
                        const newColor = e.target.value;
                        setOverlayColor(newColor);
                        chart.overrideOverlay({
                          id: selectedOverlayId,
                          styles: { line: { color: newColor, size: overlayWidth } },
                        });
                        setTimeout(() => {
                          const snapshot = captureDrawingSnapshot(chart);
                          drawingHistory.current.push(snapshot);
                          setCanUndoDrawing(drawingHistory.current.canUndo());
                          setCanRedoDrawing(drawingHistory.current.canRedo());
                        }, 0);
                      }}
                    />
                  </label>
                  <label htmlFor="overlay-width-picker" className="provider-drawing-restyle-label">
                    Width
                    <input
                      id="overlay-width-picker"
                      type="range"
                      min={1}
                      max={5}
                      step={1}
                      value={overlayWidth}
                      onChange={(e) => {
                        const chart = chartInstance.current;
                        if (chart === undefined || selectedOverlayId === undefined) return;
                        const newWidth = Number(e.target.value);
                        setOverlayWidth(newWidth);
                        chart.overrideOverlay({
                          id: selectedOverlayId,
                          styles: { line: { color: overlayColor, size: newWidth } },
                        });
                        setTimeout(() => {
                          const snapshot = captureDrawingSnapshot(chart);
                          drawingHistory.current.push(snapshot);
                          setCanUndoDrawing(drawingHistory.current.canUndo());
                          setCanRedoDrawing(drawingHistory.current.canRedo());
                        }, 0);
                      }}
                    />
                    <span aria-hidden="true">{overlayWidth}px</span>
                  </label>
                </div>
              )}
            </aside>"""
if old_clear in content and "provider-drawing-restyle" not in content:
    content = content.replace(old_clear, new_clear, 1)
    print("PATCH 3 OK: added restyle controls")
elif "provider-drawing-restyle" in content:
    print("PATCH 3 SKIP: already present")
else:
    print("PATCH 3 FAIL: clear button pattern not found")

# 4. Capture overlay ID on create
old_create = "chart.createOverlay(tool.name);\n"
new_create = "const overlayId = chart.createOverlay(tool.name) as string | null;\n                if (overlayId !== null) setSelectedOverlayId(overlayId);\n"
if old_create in content and "setSelectedOverlayId(overlayId)" not in content:
    content = content.replace(old_create, new_create, 1)
    print("PATCH 4 OK: capture overlay ID on create")
elif "setSelectedOverlayId(overlayId)" in content:
    print("PATCH 4 SKIP: already present")
else:
    print("PATCH 4 FAIL: createOverlay pattern not found")

with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
print("DONE")