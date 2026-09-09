import { authoringFrame } from "./authoring-context.js";
import type {
  IndicatorInputDefinition,
  IndicatorInputOption,
  IndicatorInputValue,
} from "./index.js";

export interface InputOptions {
  readonly key?: string;
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
export interface StringInputOptions extends InputOptions {
  readonly options?: readonly (string | IndicatorInputOption)[];
}

type StringOptionValue<T> = T extends string
  ? T
  : T extends IndicatorInputOption
    ? T["value"]
    : never;

function stepDecimals(step: number): number {
  const text = `${step}`.toLowerCase();
  if (text.includes("e-")) {
    const [coefficient = "", exponent = "0"] = text.split("e-");
    const fraction = coefficient.split(".")[1]?.length ?? 0;
    return Math.min(20, fraction + Number(exponent));
  }
  return Math.min(20, text.split(".")[1]?.length ?? 0);
}

/** Runtime-safe input normalization. Missing, stale, and invalid persisted values fall back silently. */
export function normalizeIndicatorInputValue(
  definition: IndicatorInputDefinition,
  value: unknown,
): IndicatorInputValue {
  if (definition.type === "boolean")
    return typeof value === "boolean" ? value : definition.defaultValue;
  if (definition.type === "number") {
    const raw =
      typeof value === "number" && Number.isFinite(value)
        ? value
        : definition.defaultValue;
    const bounded = Math.min(
      definition.max ?? raw,
      Math.max(definition.min ?? raw, raw),
    );
    if (definition.step === undefined) return bounded;
    return Number(bounded.toFixed(stepDecimals(definition.step)));
  }
  if (typeof value !== "string" || value.length > 8_192)
    return definition.defaultValue;
  if (
    definition.options !== undefined &&
    !definition.options.some((option) => option.value === value)
  )
    return definition.defaultValue;
  return value;
}

/**
 * Canonicalizes persisted parameters against the current declaration.
 * Unknown old keys are ignored and newly added keys receive their defaults.
 */
export function normalizeIndicatorParameters(
  definitions: readonly IndicatorInputDefinition[],
  supplied: Readonly<Record<string, unknown>>,
): Readonly<Record<string, IndicatorInputValue>> {
  return Object.freeze(
    Object.fromEntries(
      definitions.map((definition) => [
        definition.key,
        normalizeIndicatorInputValue(definition, supplied[definition.key]),
      ]),
    ),
  );
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
  return normalizeIndicatorInputValue(
    definition,
    frame.parameters[definition.key],
  );
}

function metadata(options: InputOptions) {
  const key = options.key ?? `input_${authoringFrame().inputIndex}`;
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

function stringOptions(
  options: readonly (string | IndicatorInputOption)[] | undefined,
): readonly IndicatorInputOption[] | undefined {
  return options?.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
}

function number(
  defaultValue: number,
  options: NumberInputOptions = {},
): number {
  if (
    !Number.isFinite(defaultValue) ||
    (options.min !== undefined && !Number.isFinite(options.min)) ||
    (options.max !== undefined && !Number.isFinite(options.max)) ||
    (options.step !== undefined &&
      (!Number.isFinite(options.step) || options.step <= 0)) ||
    (options.min !== undefined &&
      options.max !== undefined &&
      options.min > options.max) ||
    (options.min !== undefined && defaultValue < options.min) ||
    (options.max !== undefined && defaultValue > options.max)
  )
    throw new RangeError("Numeric input declaration is invalid.");
  const value = readInput({
    ...metadata(options),
    type: "number",
    defaultValue,
    ...(options.min === undefined ? {} : { min: options.min }),
    ...(options.max === undefined ? {} : { max: options.max }),
    ...(options.step === undefined ? {} : { step: options.step }),
  }) as number;
  return value;
}

function stringInput<
  const O extends readonly (string | IndicatorInputOption)[],
>(
  defaultValue: StringOptionValue<O[number]>,
  options: StringInputOptions & { readonly options: O },
): StringOptionValue<O[number]>;
function stringInput(
  defaultValue: string,
  options?: StringInputOptions,
): string;
function stringInput(
  defaultValue: string,
  options: StringInputOptions = {},
): string {
  const choices = stringOptions(options.options);
  if (
    choices !== undefined &&
    !choices.some((option) => option.value === defaultValue)
  )
    throw new RangeError("String input default must be one of its options.");
  return readInput({
    ...metadata(options),
    type: "string",
    defaultValue,
    ...(choices === undefined ? {} : { options: choices }),
  }) as string;
}

export interface InputApi {
  readonly float: (
    defaultValue: number,
    options?: NumberInputOptions,
  ) => number;
  readonly int: (defaultValue: number, options?: NumberInputOptions) => number;
  readonly bool: (defaultValue: boolean, options?: InputOptions) => boolean;
  readonly string: {
    <const O extends readonly (string | IndicatorInputOption)[]>(
      defaultValue: StringOptionValue<O[number]>,
      options: StringInputOptions & { readonly options: O },
    ): StringOptionValue<O[number]>;
    (defaultValue: string, options?: StringInputOptions): string;
  };
  readonly color: (defaultValue: string, options?: InputOptions) => string;
}

export const input: InputApi = Object.freeze({
  float: number,
  int(defaultValue: number, options: NumberInputOptions = {}): number {
    if (!Number.isSafeInteger(defaultValue))
      throw new RangeError("Integer input default must be a safe integer.");
    const value = number(defaultValue, { ...options, step: 1 });
    if (!Number.isSafeInteger(value)) return defaultValue;
    return value;
  },
  bool: (defaultValue: boolean, options: InputOptions = {}): boolean =>
    readInput({
      ...metadata(options),
      type: "boolean",
      defaultValue,
    }) as boolean,
  string: stringInput,
  color: (defaultValue: string, options: InputOptions = {}): string =>
    readInput({
      ...metadata(options),
      type: "string",
      defaultValue,
      editor: "color",
    }) as string,
});
