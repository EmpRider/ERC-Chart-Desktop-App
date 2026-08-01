# ECDD-59 React Dark Shell Design

## Scope

Replace the development-only DOM renderer with the first production React shell. The shell is dark-only and includes app identity, secure-bridge state, an empty workspace surface, and a safe unavailable state.

Tabs and one-to-four layouts are deliberately absent until ECDD-60. No chart controls, provider controls, persistence, network behavior, or settings are exposed early.

## Composition

The renderer has three visible regions:

- a compact header with the ERC Chart mark, product name, desktop-workspace label, and live bridge-state badge;
- a flexible workspace canvas with a quiet grid treatment and a centered “Workspace ready” empty state;
- a small local-session footer.

The palette uses near-black navy surfaces, restrained slate borders, cyan/blue accents, and high-contrast text. The layout fills the native window, remains usable at narrow widths, and honors reduced-motion preferences.

## React boundary

`ApplicationShell` is a presentational React component driven by a small bridge-state value. `resolveBridgeState` validates the preload response outside the component and converts success or failure to safe UI state. The runtime entry mounts with `createRoot` and updates state from an effect without leaking rejected error values.

React and React DOM are exact production dependencies of `@erc-chart/renderer`; their type packages are exact development dependencies. The renderer remains browser-only and imports no Electron or Node API.

## Security and accessibility

The shell is compatible with the ECDD-58 CSP: no inline script, inline style, eval, remote asset, font, or network request is added. Status text uses `role="status"` and a polite live region. Structural landmarks, headings, visible focus treatment, high contrast, and semantic text remain available without canvas.

## Verification

Server-rendered component tests assert semantic structure and both bridge states. Resolver tests cover valid, missing, rejected, and malformed bridge results. Runtime build tests prove React is bundled into the existing self-contained renderer asset; the sandbox-enabled Electron smoke proves the connected state renders with no Node globals.
