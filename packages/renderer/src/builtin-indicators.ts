import type { WorkspaceIndicator } from "@erc-chart/contracts";

export const builtInIndicatorPluginId = "erc.builtin.klinecharts" as const;

export type BuiltInIndicatorPlacement = "overlay" | "panel";

export interface BuiltInIndicatorNumberParameter {
  readonly kind: "number";
  readonly key: string;
  readonly label: string;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface BuiltInIndicatorSelectParameter {
  readonly kind: "select";
  readonly key: string;
  readonly label: string;
  readonly defaultValue: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}

export type BuiltInIndicatorParameter =
  BuiltInIndicatorNumberParameter | BuiltInIndicatorSelectParameter;

export interface BuiltInKLineIndicatorSpec {
  readonly id: string;
  readonly ownerInstanceId: string;
  readonly name: string;
  readonly shortName: string;
  readonly placement: BuiltInIndicatorPlacement;
  readonly calcParams: readonly number[];
  readonly precision?: number;
  readonly visible: boolean;
}

export interface BuiltInIndicatorDefinition {
  readonly id:
    | "rsi"
    | "macd"
    | "bollinger"
    | "moving-average"
    | "ma-crossover"
    | "atr"
    | "adx"
    | "stochastic";
  readonly name: string;
  readonly description: string;
  readonly placement: BuiltInIndicatorPlacement;
  readonly parameters: readonly BuiltInIndicatorParameter[];
}

const length14: BuiltInIndicatorNumberParameter = {
  kind: "number",
  key: "length",
  label: "Length",
  defaultValue: 14,
  min: 1,
  max: 500,
  step: 1,
};

const crossoverAverageTypeOptions = [
  { value: "sma", label: "SMA" },
  { value: "ema", label: "EMA" },
  { value: "rma", label: "RMA" },
] as const;

const movingAverageTypeOptions = [
  { value: "sma", label: "SMA" },
  { value: "ema", label: "EMA" },
  { value: "wma", label: "WMA" },
] as const;

export const builtInIndicatorDefinitions: readonly BuiltInIndicatorDefinition[] =
  [
    {
      id: "rsi",
      name: "RSI",
      description: "Relative Strength Index",
      placement: "panel",
      parameters: [length14],
    },
    {
      id: "macd",
      name: "MACD",
      description: "Moving Average Convergence / Divergence",
      placement: "panel",
      parameters: [
        {
          kind: "number",
          key: "fast",
          label: "Fast length",
          defaultValue: 12,
          min: 1,
          max: 500,
          step: 1,
        },
        {
          kind: "number",
          key: "slow",
          label: "Slow length",
          defaultValue: 26,
          min: 1,
          max: 500,
          step: 1,
        },
        {
          kind: "number",
          key: "signal",
          label: "Signal length",
          defaultValue: 9,
          min: 1,
          max: 500,
          step: 1,
        },
      ],
    },
    {
      id: "bollinger",
      name: "Bollinger Bands",
      description: "Bollinger Bands",
      placement: "overlay",
      parameters: [
        {
          kind: "number",
          key: "length",
          label: "Length",
          defaultValue: 20,
          min: 1,
          max: 500,
          step: 1,
        },
        {
          kind: "number",
          key: "multiplier",
          label: "Std. deviation",
          defaultValue: 2,
          min: 0.1,
          max: 10,
          step: 0.1,
        },
      ],
    },
    {
      id: "moving-average",
      name: "Moving Average",
      description: "Single moving average",
      placement: "overlay",
      parameters: [
        {
          kind: "number",
          key: "length",
          label: "Length",
          defaultValue: 20,
          min: 1,
          max: 500,
          step: 1,
        },
        {
          kind: "select",
          key: "method",
          label: "Method",
          defaultValue: "sma",
          options: movingAverageTypeOptions,
        },
      ],
    },
    {
      id: "ma-crossover",
      name: "MA Crossover",
      description: "Fast and slow moving averages",
      placement: "overlay",
      parameters: [
        {
          kind: "number",
          key: "fastPeriod",
          label: "Fast length",
          defaultValue: 10,
          min: 1,
          max: 500,
          step: 1,
        },
        {
          kind: "number",
          key: "slowPeriod",
          label: "Slow length",
          defaultValue: 20,
          min: 1,
          max: 500,
          step: 1,
        },
        {
          kind: "select",
          key: "fastType",
          label: "Fast method",
          defaultValue: "ema",
          options: crossoverAverageTypeOptions,
        },
        {
          kind: "select",
          key: "slowType",
          label: "Slow method",
          defaultValue: "sma",
          options: crossoverAverageTypeOptions,
        },
      ],
    },
    {
      id: "atr",
      name: "ATR",
      description: "Average True Range",
      placement: "panel",
      parameters: [length14],
    },
    {
      id: "adx",
      name: "ADX",
      description: "Average Directional Index",
      placement: "panel",
      parameters: [length14],
    },
    {
      id: "stochastic",
      name: "Stochastic",
      description: "Stochastic oscillator",
      placement: "panel",
      parameters: [
        {
          kind: "number",
          key: "k",
          label: "%K length",
          defaultValue: 14,
          min: 1,
          max: 500,
          step: 1,
        },
        {
          kind: "number",
          key: "d",
          label: "%D length",
          defaultValue: 3,
          min: 1,
          max: 500,
          step: 1,
        },
        {
          kind: "number",
          key: "smooth",
          label: "Smoothing",
          defaultValue: 3,
          min: 1,
          max: 500,
          step: 1,
        },
      ],
    },
  ];

export function getBuiltInIndicatorDefinition(
  definitionId: string,
): BuiltInIndicatorDefinition | undefined {
  return builtInIndicatorDefinitions.find(
    (definition) => definition.id === definitionId,
  );
}

export function createBuiltInWorkspaceIndicator(
  definitionId: BuiltInIndicatorDefinition["id"],
  instanceId: string,
): WorkspaceIndicator {
  const definition = getBuiltInIndicatorDefinition(definitionId);
  if (definition === undefined) {
    throw new Error(`Unknown built-in indicator: ${definitionId}`);
  }
  const parameters = Object.fromEntries(
    definition.parameters.map((parameter) => [
      parameter.key,
      parameter.defaultValue,
    ]),
  );
  return {
    instanceId,
    pluginId: builtInIndicatorPluginId,
    definitionId,
    enabled: true,
    parameters,
    inputs: { source: { kind: "candles" } },
  };
}

function numberParameterValue(
  indicator: WorkspaceIndicator,
  parameter: BuiltInIndicatorNumberParameter,
): number {
  const value = indicator.parameters[parameter.key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return parameter.defaultValue;
  }
  const bounded = Math.min(parameter.max, Math.max(parameter.min, value));
  if (parameter.step >= 1) return Math.round(bounded);
  const decimals = Math.max(0, `${parameter.step}`.split(".")[1]?.length ?? 0);
  return Number(bounded.toFixed(decimals));
}

function selectParameterValue(
  indicator: WorkspaceIndicator,
  parameter: BuiltInIndicatorSelectParameter,
): string {
  const value = indicator.parameters[parameter.key];
  if (
    typeof value === "string" &&
    parameter.options.some((option) => option.value === value)
  ) {
    return value;
  }
  return parameter.defaultValue;
}

export function normalizeBuiltInIndicatorParameters(
  indicator: WorkspaceIndicator,
): Readonly<Record<string, number | string>> | undefined {
  if (indicator.pluginId !== builtInIndicatorPluginId) return undefined;
  const definition = getBuiltInIndicatorDefinition(indicator.definitionId);
  if (definition === undefined) return undefined;
  return Object.fromEntries(
    definition.parameters.map((parameter) => [
      parameter.key,
      parameter.kind === "number"
        ? numberParameterValue(indicator, parameter)
        : selectParameterValue(indicator, parameter),
    ]),
  );
}

function movingAverageSpec(
  ownerInstanceId: string,
  runtimeId: string,
  shortName: string,
  method: string,
  period: number,
  visible: boolean,
): BuiltInKLineIndicatorSpec {
  if (method === "ema") {
    return {
      id: runtimeId,
      ownerInstanceId,
      name: "EMA",
      shortName,
      placement: "overlay",
      calcParams: [period],
      visible,
    };
  }
  if (method === "rma") {
    return {
      id: runtimeId,
      ownerInstanceId,
      name: "SMA",
      shortName,
      placement: "overlay",
      calcParams: [period, 1],
      visible,
    };
  }
  if (method === "wma") {
    return {
      id: runtimeId,
      ownerInstanceId,
      name: "ERC_WMA",
      shortName,
      placement: "overlay",
      calcParams: [period],
      visible,
    };
  }
  return {
    id: runtimeId,
    ownerInstanceId,
    name: "MA",
    shortName,
    placement: "overlay",
    calcParams: [period],
    visible,
  };
}

export function toBuiltInKLineIndicatorSpecs(
  indicator: WorkspaceIndicator,
): readonly BuiltInKLineIndicatorSpec[] {
  const parameters = normalizeBuiltInIndicatorParameters(indicator);
  if (parameters === undefined) return [];
  const visible = indicator.enabled;
  const ownerInstanceId = indicator.instanceId;
  const common = {
    id: ownerInstanceId,
    ownerInstanceId,
    visible,
  } as const;

  switch (indicator.definitionId) {
    case "rsi":
      return [
        {
          ...common,
          name: "RSI",
          shortName: "RSI",
          placement: "panel",
          calcParams: [parameters.length as number],
        },
      ];
    case "macd":
      return [
        {
          ...common,
          name: "MACD",
          shortName: "MACD",
          placement: "panel",
          calcParams: [
            parameters.fast as number,
            parameters.slow as number,
            parameters.signal as number,
          ],
          precision: 8,
        },
      ];
    case "bollinger":
      return [
        {
          ...common,
          name: "BOLL",
          shortName: "Bollinger Bands",
          placement: "overlay",
          calcParams: [
            parameters.length as number,
            parameters.multiplier as number,
          ],
        },
      ];
    case "moving-average":
      return [
        movingAverageSpec(
          ownerInstanceId,
          ownerInstanceId,
          "Moving Average",
          parameters.method as string,
          parameters.length as number,
          visible,
        ),
      ];
    case "ma-crossover":
      return [
        movingAverageSpec(
          ownerInstanceId,
          `${ownerInstanceId}:fast`,
          "MA Cross Fast",
          parameters.fastType as string,
          parameters.fastPeriod as number,
          visible,
        ),
        movingAverageSpec(
          ownerInstanceId,
          `${ownerInstanceId}:slow`,
          "MA Cross Slow",
          parameters.slowType as string,
          parameters.slowPeriod as number,
          visible,
        ),
      ];
    case "atr":
      return [
        {
          ...common,
          name: "ERC_ATR",
          shortName: "ATR",
          placement: "panel",
          calcParams: [parameters.length as number],
        },
      ];
    case "adx":
      return [
        {
          ...common,
          name: "DMI",
          shortName: "ADX",
          placement: "panel",
          calcParams: [parameters.length as number, 6],
        },
      ];
    case "stochastic":
      return [
        {
          ...common,
          name: "KDJ",
          shortName: "Stochastic",
          placement: "panel",
          calcParams: [
            parameters.k as number,
            parameters.d as number,
            parameters.smooth as number,
          ],
        },
      ];
    default:
      return [];
  }
}

export function updateBuiltInIndicatorParameters(
  indicator: WorkspaceIndicator,
  draft: Readonly<Record<string, string>>,
): WorkspaceIndicator | undefined {
  if (indicator.pluginId !== builtInIndicatorPluginId) return undefined;
  const definition = getBuiltInIndicatorDefinition(indicator.definitionId);
  if (definition === undefined) return undefined;
  const parameters = Object.fromEntries(
    definition.parameters.map((parameter) => {
      const raw = draft[parameter.key];
      if (parameter.kind === "select") {
        const value = parameter.options.some((option) => option.value === raw)
          ? raw
          : parameter.defaultValue;
        return [parameter.key, value];
      }
      const parsed = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
      const value = Number.isFinite(parsed)
        ? Math.min(parameter.max, Math.max(parameter.min, parsed))
        : parameter.defaultValue;
      return [
        parameter.key,
        parameter.step >= 1
          ? Math.round(value)
          : Number(
              value.toFixed(
                Math.max(0, `${parameter.step}`.split(".")[1]?.length ?? 0),
              ),
            ),
      ];
    }),
  );
  return { ...indicator, parameters };
}
