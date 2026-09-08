import { authoringFrame } from "./authoring-context.js";
import type { IndicatorInputDefinition, IndicatorInputValue } from "./index.js";

export interface InputOptions {
  readonly title?: string;
  readonly group?: string;
  readonly description?: string;
  readonly effect?: "calculation" | "presentation";
}
export interface NumberInputOptions extends InputOptions {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

function readInput(definition: IndicatorInputDefinition): IndicatorInputValue {
  const frame = authoringFrame();
  const index = frame.inputIndex++;
  if (index >= 128)
    throw new RangeError("An indicator may declare at most 128 inputs.");
  if (frame.discovery) frame.inputs.push(definition);
  else {
    const expected = frame.inputs[index];
    if (
      expected?.key !== definition.key ||
      expected.type !== definition.type ||
      expected.label !== definition.label
    )
      throw new Error(
        "Input declarations must remain in the same order on every bar.",
      );
  }
  const value = frame.parameters[definition.key] ?? definition.defaultValue;
  if (typeof value !== typeof definition.defaultValue)
    throw new TypeError(`Invalid input: ${definition.label}`);
  return value;
}

function metadata(options: InputOptions) {
  const key = `input_${authoringFrame().inputIndex}`;
  return {
    key,
    label: options.title ?? key,
    ...(options.group === undefined ? {} : { group: options.group }),
    ...(options.description === undefined
      ? {}
      : { description: options.description }),
    ...(options.effect === undefined ? {} : { effect: options.effect }),
  };
}

function number(
  defaultValue: number,
  options: NumberInputOptions = {},
): number {
  const value = readInput({
    ...metadata(options),
    type: "number",
    defaultValue,
    ...(options.min === undefined ? {} : { min: options.min }),
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.step === undefined ? {} : { step: options.step }),
  }) as number;
  if (
    !Number.isFinite(value) ||
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max)
  )
    throw new RangeError("Numeric input is outside its declared bounds.");
  return value;
}

export interface InputApi {
  readonly float: (
    defaultValue: number,
    options?: NumberInputOptions,
  ) => number;
  readonly int: (defaultValue: number, options?: NumberInputOptions) => number;
  readonly bool: (defaultValue: boolean, options?: InputOptions) => boolean;
  readonly string: (defaultValue: string, options?: InputOptions) => string;
  readonly color: (defaultValue: string, options?: InputOptions) => string;
}

export const input: InputApi = Object.freeze({
  float: number,
  int(defaultValue: number, options: NumberInputOptions = {}): number {
    const value = number(defaultValue, { ...options, step: 1 });
    if (!Number.isSafeInteger(value))
      throw new RangeError("Integer input must be a safe integer.");
    return value;
  },
  bool: (defaultValue: boolean, options: InputOptions = {}): boolean =>
    readInput({
      ...metadata(options),
      type: "boolean",
      defaultValue,
    }) as boolean,
  string: (defaultValue: string, options: InputOptions = {}): string =>
    readInput({ ...metadata(options), type: "string", defaultValue }) as string,
  color: (defaultValue: string, options: InputOptions = {}): string =>
    readInput({
      ...metadata(options),
      type: "string",
      defaultValue,
      editor: "color",
    }) as string,
});
