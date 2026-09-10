export type CompilerCallsiteKind =
  | "input"
  | "ta"
  | "state"
  | "plot"
  | "drawing"
  | "signal";

export interface CompilerCallsite {
  readonly __ercCallsite: "v2";
  readonly id: string;
  readonly kind: CompilerCallsiteKind;
  readonly callee: string;
  readonly source: {
    readonly file: string;
    readonly line: number;
    readonly column: number;
  };
}

const callsiteSuffix = /^[0-9a-f]{24}$/u;

function invalidCallsite(callee: string): TypeError {
  return new TypeError(
    `Invalid compiler call-site metadata for ${callee}; rebuild the indicator package with the SDK v2 authoring compiler.`,
  );
}

export function readCompilerCallsite(
  value: unknown,
  kind: CompilerCallsiteKind,
  callee: string,
): CompilerCallsite | undefined {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value !== "object" ||
    !("__ercCallsite" in value) ||
    !("id" in value) ||
    !("kind" in value) ||
    !("callee" in value) ||
    !("source" in value)
  )
    throw invalidCallsite(callee);
  const candidate = value as Partial<CompilerCallsite>;
  const source = candidate.source;
  const prefix = `erc-v2-${kind}-`;
  if (
    candidate.__ercCallsite !== "v2" ||
    candidate.kind !== kind ||
    candidate.callee !== callee ||
    typeof candidate.id !== "string" ||
    !candidate.id.startsWith(prefix) ||
    !callsiteSuffix.test(candidate.id.slice(prefix.length)) ||
    source === null ||
    typeof source !== "object" ||
    typeof source.file !== "string" ||
    source.file.length === 0 ||
    !Number.isSafeInteger(source.line) ||
    source.line < 1 ||
    !Number.isSafeInteger(source.column) ||
    source.column < 1
  )
    throw invalidCallsite(callee);
  return candidate as CompilerCallsite;
}
