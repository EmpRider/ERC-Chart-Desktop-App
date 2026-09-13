declare const __ERC_INDICATOR_COMPILED__: boolean;

const compilerCallsiteKinds = [
  "input",
  "ta",
  "state",
  "plot",
  "drawing",
  "signal",
] as const;

export type CompilerCallsiteKind = (typeof compilerCallsiteKinds)[number];

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
const validatedFrozenCallsites = new WeakMap<object, CompilerCallsite>();

function compiledIndicatorPackage(): boolean {
  return (
    typeof __ERC_INDICATOR_COMPILED__ !== "undefined" &&
    __ERC_INDICATOR_COMPILED__ === true
  );
}

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
  if (!compilerCallsiteKinds.includes(kind)) throw invalidCallsite(callee);
  if (value === undefined) {
    if (compiledIndicatorPackage())
      throw new TypeError(
        `Missing compiler call-site identity for ${callee}; rebuild the indicator package with the SDK v2 authoring compiler.`,
      );
    return undefined;
  }
  if (value !== null && typeof value === "object") {
    const cached = validatedFrozenCallsites.get(value);
    if (cached !== undefined) {
      if (cached.kind !== kind || cached.callee !== callee)
        throw invalidCallsite(callee);
      return cached;
    }
  }
  if (value === null || typeof value !== "object")
    throw invalidCallsite(callee);
  const candidate = value as Partial<CompilerCallsite>;
  const marker = candidate.__ercCallsite;
  const id = candidate.id;
  const candidateKind = candidate.kind;
  const candidateCallee = candidate.callee;
  const source = candidate.source;
  const sourceFile = source?.file;
  const sourceLine = source?.line;
  const sourceColumn = source?.column;
  const prefix = `erc-v2-${kind}-`;
  if (
    marker !== "v2" ||
    candidateKind !== kind ||
    candidateCallee !== callee ||
    typeof id !== "string" ||
    !id.startsWith(prefix) ||
    !callsiteSuffix.test(id.slice(prefix.length)) ||
    source === null ||
    typeof source !== "object" ||
    typeof sourceFile !== "string" ||
    sourceFile.length === 0 ||
    typeof sourceLine !== "number" ||
    !Number.isSafeInteger(sourceLine) ||
    sourceLine < 1 ||
    typeof sourceColumn !== "number" ||
    !Number.isSafeInteger(sourceColumn) ||
    sourceColumn < 1
  )
    throw invalidCallsite(callee);
  const validated: CompilerCallsite = Object.freeze({
    __ercCallsite: "v2",
    id,
    kind,
    callee,
    source: Object.freeze({
      file: sourceFile,
      line: sourceLine,
      column: sourceColumn,
    }),
  });
  if (Object.isFrozen(value)) validatedFrozenCallsites.set(value, validated);
  return validated;
}
