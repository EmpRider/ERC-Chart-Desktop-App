import { authoringFrame } from "./authoring-context.js";

export interface SignalOptions {
  readonly id?: string;
  readonly confidence?: number;
}

/** Only finalized bars emit signals; provisional conditions never become committed events. */
export function signal(
  condition: boolean,
  direction: "long" | "short" | "neutral",
  options: SignalOptions = {},
): void {
  const frame = authoringFrame();
  const index = frame.signalIndex++;
  if (index >= 128)
    throw new RangeError("At most 128 signal conditions are allowed per bar.");
  if (
    options.confidence !== undefined &&
    (!Number.isFinite(options.confidence) ||
      options.confidence < 0 ||
      options.confidence > 1)
  )
    throw new RangeError("Signal confidence must be between 0 and 1.");
  if (condition && !frame.discovery && frame.phase === "finalized")
    frame.signals.push({
      key: options.id ?? `signal_${index}`,
      direction,
      ...(options.confidence === undefined
        ? {}
        : { confidence: options.confidence }),
    });
}
