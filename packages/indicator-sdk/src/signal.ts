import { authoringFrame, type AuthoringFrame } from "./authoring-context.js";
import { readCompilerCallsite } from "./internal/callsite.js";

export interface SignalOptions {
  readonly confidence?: number;
}

const frameSignalIdentities = new WeakMap<AuthoringFrame, Set<string>>();

function signalIdentities(frame: AuthoringFrame): Set<string> {
  let identities = frameSignalIdentities.get(frame);
  if (identities === undefined) {
    identities = new Set();
    frameSignalIdentities.set(frame, identities);
  }
  return identities;
}

/** Only finalized bars emit signals; provisional conditions never become committed events. */
export function signal(
  condition: boolean,
  direction: "long" | "short" | "neutral",
  options: SignalOptions = {},
  hiddenCallsite?: unknown,
): void {
  const frame = authoringFrame();
  const callsite = readCompilerCallsite(hiddenCallsite, "signal", "signal");
  const index = frame.signalIndex++;
  if (index >= 128)
    throw new RangeError("At most 128 signal conditions are allowed per bar.");
  if ("id" in options)
    throw new TypeError("Signal persistence identity is owned by the SDK.");
  if (
    options.confidence !== undefined &&
    (!Number.isFinite(options.confidence) ||
      options.confidence < 0 ||
      options.confidence > 1)
  )
    throw new RangeError("Signal confidence must be between 0 and 1.");
  if (
    callsite !== undefined &&
    !frame.discovery &&
    frame.phase === "finalized"
  ) {
    const identities = signalIdentities(frame);
    if (identities.has(callsite.id))
      throw new Error(
        `Compiler call-site identity ${callsite.id} for signal executed more than once in one finalized bar.`,
      );
    identities.add(callsite.id);
  }
  if (condition && !frame.discovery && frame.phase === "finalized")
    frame.signals.push({
      key: callsite?.id ?? `signal_${index}`,
      direction,
      ...(options.confidence === undefined
        ? {}
        : { confidence: options.confidence }),
    });
}
