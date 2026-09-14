import { authoringFrame } from "./authoring-context.js";
import {
  readCompilerCallsite,
  type CompilerCallsite,
} from "./internal/callsite.js";
import type {
  IndicatorInputDefinition,
  IndicatorInputOption,
  IndicatorInputValue,
} from "./index.js";
import { candle, type CandleTypeSelection } from "./constants.js";
import { priceSources, priceValue, type PriceSource } from "./series.js";

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

interface InputDeclarationMetadata {
  readonly labelExplicit: boolean;
}

const inputDeclarationMetadata = new WeakMap<
  IndicatorInputDefinition,
  InputDeclarationMetadata
>();

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
  if (definition.type === "source")
    return typeof value === "string" &&
      priceSources.includes(value as PriceSource)
      ? value
      : definition.defaultValue;
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

function sameInputOptions(
  expected: readonly IndicatorInputOption[] | undefined,
  options: readonly IndicatorInputOption[] | undefined,
): boolean {
  if (expected === options) return true;
  if (
    expected === undefined ||
    options === undefined ||
    expected.length !== options.length
  )
    return false;
  return expected.every((option, index) => {
    const candidate = options[index];
    return (
      candidate !== undefined &&
      option.value === candidate.value &&
      option.label === candidate.label
    );
  });
}

function sameInputDefinition(
  expected: IndicatorInputDefinition | undefined,
  definition: IndicatorInputDefinition,
): boolean {
  if (
    expected === undefined ||
    expected.key !== definition.key ||
    expected.label !== definition.label ||
    expected.group !== definition.group ||
    expected.description !== definition.description ||
    expected.effect !== definition.effect ||
    expected.type !== definition.type
  )
    return false;

  switch (expected.type) {
    case "boolean":
      return (
        definition.type === "boolean" &&
        expected.defaultValue === definition.defaultValue
      );
    case "number":
      return (
        definition.type === "number" &&
        expected.defaultValue === definition.defaultValue &&
        expected.min === definition.min &&
        expected.max === definition.max &&
        expected.step === definition.step
      );
    case "string":
      return (
        definition.type === "string" &&
        expected.defaultValue === definition.defaultValue &&
        expected.editor === definition.editor &&
        sameInputOptions(expected.options, definition.options)
      );
    case "source":
      return (
        definition.type === "source" &&
        expected.defaultValue === definition.defaultValue
      );
  }
}

function readInput(
  definition: IndicatorInputDefinition,
  callsite: CompilerCallsite | undefined,
  labelExplicit: boolean,
): IndicatorInputValue {
  const frame = authoringFrame();
  const index = frame.inputIndex++;
  if (index >= 128)
    throw new RangeError("An indicator may declare at most 128 inputs.");
  if (frame.discovery) {
    if (
      callsite !== undefined &&
      frame.inputs.some((value) => value.key === callsite.id)
    )
      throw new Error(
        `Compiler call-site identity ${callsite.id} was used by more than one input declaration.`,
      );
    frame.inputs.push(definition);
    if (callsite !== undefined)
      inputDeclarationMetadata.set(definition, { labelExplicit });
  } else {
    const expected =
      callsite === undefined
        ? frame.inputs[index]
        : frame.inputs.find((value) => value.key === callsite.id);
    let comparableDefinition = definition;
    if (callsite !== undefined && expected !== undefined) {
      const declarationMetadata = inputDeclarationMetadata.get(expected);
      if (
        declarationMetadata === undefined ||
        declarationMetadata.labelExplicit !== labelExplicit
      )
        throw new Error(
          `Input declaration identity ${callsite.id} does not match the discovered input contract.`,
        );
      if (!declarationMetadata.labelExplicit)
        comparableDefinition = { ...definition, label: expected.label };
    }
    if (!sameInputDefinition(expected, comparableDefinition))
      throw new Error(
        callsite === undefined
          ? "Input declarations must remain in the same order on every bar."
          : `Input declaration identity ${callsite.id} does not match the discovered input contract.`,
      );
  }
  return normalizeIndicatorInputValue(
    definition,
    frame.parameters[definition.key],
  );
}

function metadata(
  options: InputOptions,
  callsite: CompilerCallsite | undefined,
) {
  const positionalKey = `input_${authoringFrame().inputIndex}`;
  const key = callsite?.id ?? options.key ?? positionalKey;
  return {
    key,
    label: options.title ?? options.key ?? positionalKey,
    ...(options.group === undefined ? {} : { group: options.group }),
    ...(options.description === undefined
      ? {}
      : { description: options.description }),
    ...(options.effect === undefined ? {} : { effect: options.effect }),
  };
}

function hasExplicitLabel(options: InputOptions): boolean {
  return options.title !== undefined || options.key !== undefined;
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
  hiddenCallsite?: unknown,
  callee = "input.float",
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
  const callsite = readCompilerCallsite(hiddenCallsite, "input", callee);
  const value = readInput(
    {
      ...metadata(options, callsite),
      type: "number",
      defaultValue,
      ...(options.min === undefined ? {} : { min: options.min }),
      ...(options.max === undefined ? {} : { max: options.max }),
      ...(options.step === undefined ? {} : { step: options.step }),
    },
    callsite,
    hasExplicitLabel(options),
  ) as number;
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
  hiddenCallsite?: unknown,
): string {
  const choices = stringOptions(options.options);
  if (
    choices !== undefined &&
    !choices.some((option) => option.value === defaultValue)
  )
    throw new RangeError("String input default must be one of its options.");
  const callsite = readCompilerCallsite(
    hiddenCallsite,
    "input",
    "input.string",
  );
  return readInput(
    {
      ...metadata(options, callsite),
      type: "string",
      defaultValue,
      ...(choices === undefined ? {} : { options: choices }),
    },
    callsite,
    hasExplicitLabel(options),
  ) as string;
}

function timeframeInput(
  defaultValue: string,
  titleOrOptions: string | InputOptions = {},
  hiddenCallsite?: unknown,
): string {
  const options =
    typeof titleOrOptions === "string"
      ? { title: titleOrOptions }
      : titleOrOptions;
  if (
    defaultValue.length === 0 ||
    defaultValue.length > 64 ||
    defaultValue.trim() !== defaultValue
  ) {
    throw new RangeError(
      "Timeframe input default must be a non-empty timeframe ID.",
    );
  }
  const callsite = readCompilerCallsite(
    hiddenCallsite,
    "input",
    "input.timeframe",
  );
  const definition: IndicatorInputDefinition = {
    ...metadata(options, callsite),
    type: "string",
    defaultValue,
    editor: "timeframe",
  };
  const value = readInput(
    definition,
    callsite,
    hasExplicitLabel(options),
  ) as string;
  const frame = authoringFrame();
  if (frame.discovery)
    frame.timeframeInputs.push({ key: definition.key, value });
  return value;
}

function candleTypeInput(
  defaultValue: CandleTypeSelection,
  titleOrOptions: string | InputOptions = {},
  hiddenCallsite?: unknown,
): CandleTypeSelection {
  const options =
    typeof titleOrOptions === "string"
      ? { title: titleOrOptions }
      : titleOrOptions;
  if (defaultValue !== candle.standard && defaultValue !== candle.heikinAshi)
    throw new RangeError("Candle type input default is invalid.");
  const callsite = readCompilerCallsite(
    hiddenCallsite,
    "input",
    "input.candleType",
  );
  const definition: IndicatorInputDefinition = {
    ...metadata(options, callsite),
    type: "string",
    defaultValue,
    editor: "candle-type",
    options: [
      { value: candle.standard, label: "Standard" },
      { value: candle.heikinAshi, label: "Heikin Ashi" },
    ],
  };
  const value = readInput(
    definition,
    callsite,
    hasExplicitLabel(options),
  ) as CandleTypeSelection;
  const frame = authoringFrame();
  if (frame.discovery)
    frame.candleTypeInputs.push({ key: definition.key, value });
  return value;
}

function sourceInput(
  defaultValue: PriceSource,
  titleOrOptions: string | InputOptions = {},
  hiddenCallsite?: unknown,
): number {
  if (!priceSources.includes(defaultValue))
    throw new RangeError("Source input default is invalid.");
  const options =
    typeof titleOrOptions === "string"
      ? { title: titleOrOptions }
      : titleOrOptions;
  const callsite = readCompilerCallsite(
    hiddenCallsite,
    "input",
    "input.source",
  );
  const definition: IndicatorInputDefinition = {
    ...metadata(options, callsite),
    type: "source",
    defaultValue,
  };
  const selectedSource = readInput(
    definition,
    callsite,
    hasExplicitLabel(options),
  ) as PriceSource;
  const frame = authoringFrame();
  const dependency = frame.dependencyInputs[definition.key];
  if (dependency === undefined) return priceValue(frame.candle, selectedSource);
  const point = dependency.get(frame.candle.openTimeMs);
  if (point === undefined) return Number.NaN;
  const value = Object.values(point.values)[0];
  return typeof value === "number" ? value : Number.NaN;
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
  readonly source: (
    defaultValue: PriceSource,
    titleOrOptions?: string | InputOptions,
  ) => number;
  readonly timeframe: (
    defaultValue: string,
    titleOrOptions?: string | InputOptions,
  ) => string;
  readonly candleType: (
    defaultValue: CandleTypeSelection,
    titleOrOptions?: string | InputOptions,
  ) => CandleTypeSelection;
}

export const input: InputApi = Object.freeze({
  float: number,
  int(
    defaultValue: number,
    options: NumberInputOptions = {},
    hiddenCallsite?: unknown,
  ): number {
    if (!Number.isSafeInteger(defaultValue))
      throw new RangeError("Integer input default must be a safe integer.");
    const value = number(
      defaultValue,
      { ...options, step: 1 },
      hiddenCallsite,
      "input.int",
    );
    if (!Number.isSafeInteger(value)) return defaultValue;
    return value;
  },
  bool: (
    defaultValue: boolean,
    options: InputOptions = {},
    hiddenCallsite?: unknown,
  ): boolean => {
    const callsite = readCompilerCallsite(
      hiddenCallsite,
      "input",
      "input.bool",
    );
    return readInput(
      {
        ...metadata(options, callsite),
        type: "boolean",
        defaultValue,
      },
      callsite,
      hasExplicitLabel(options),
    ) as boolean;
  },
  string: stringInput,
  source: sourceInput,
  color: (
    defaultValue: string,
    options: InputOptions = {},
    hiddenCallsite?: unknown,
  ): string => {
    const callsite = readCompilerCallsite(
      hiddenCallsite,
      "input",
      "input.color",
    );
    return readInput(
      {
        ...metadata(options, callsite),
        type: "string",
        defaultValue,
        editor: "color",
      },
      callsite,
      hasExplicitLabel(options),
    ) as string;
  },
  timeframe: timeframeInput,
  candleType: candleTypeInput,
});
