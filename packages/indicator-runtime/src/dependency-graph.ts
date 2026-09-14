export type IndicatorDependencyGraphErrorCode =
  | "INDICATOR_DEPENDENCY_DUPLICATE_INSTANCE"
  | "INDICATOR_DEPENDENCY_MISSING_INSTANCE"
  | "INDICATOR_DEPENDENCY_MISSING_OUTPUT"
  | "INDICATOR_DEPENDENCY_SELF_REFERENCE"
  | "INDICATOR_DEPENDENCY_CYCLE";

export class IndicatorDependencyGraphError extends Error {
  readonly code: IndicatorDependencyGraphErrorCode;

  constructor(code: IndicatorDependencyGraphErrorCode, message: string) {
    super(message);
    this.name = "IndicatorDependencyGraphError";
    this.code = code;
  }
}

export interface IndicatorDependencyBindingTarget {
  readonly instanceId: string;
  readonly outputKey: string;
}

export interface IndicatorDependencyNode {
  readonly instanceId: string;
  readonly outputKeys: readonly string[];
  readonly bindings: Readonly<Record<string, IndicatorDependencyBindingTarget>>;
}

export interface IndicatorDependencyBinding extends IndicatorDependencyBindingTarget {
  readonly inputKey: string;
}

export interface IndicatorDependencyPlan {
  readonly layers: readonly (readonly string[])[];
  readonly orderedInstanceIds: readonly string[];
  readonly bindingsByInstanceId: ReadonlyMap<
    string,
    readonly IndicatorDependencyBinding[]
  >;
}

export function createIndicatorDependencyPlan(
  nodes: readonly IndicatorDependencyNode[],
): IndicatorDependencyPlan {
  const byId = new Map<
    string,
    { readonly node: IndicatorDependencyNode; readonly index: number }
  >();
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node === undefined) continue;
    if (byId.has(node.instanceId)) {
      throw new IndicatorDependencyGraphError(
        "INDICATOR_DEPENDENCY_DUPLICATE_INSTANCE",
        `Indicator dependency graph contains duplicate instance ${node.instanceId}.`,
      );
    }
    byId.set(node.instanceId, { node, index });
  }

  const dependenciesById = new Map<string, Set<string>>();
  const dependentsById = new Map<string, Set<string>>();
  const outputKeysByInstanceId = new Map(
    nodes.map((node) => [node.instanceId, new Set(node.outputKeys)]),
  );
  const bindingsByInstanceId = new Map<
    string,
    readonly IndicatorDependencyBinding[]
  >();

  for (const node of nodes) {
    const dependencies = new Set<string>();
    const bindings = Object.entries(node.bindings)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([inputKey, binding]) => {
        const target = byId.get(binding.instanceId);
        if (target === undefined) {
          throw new IndicatorDependencyGraphError(
            "INDICATOR_DEPENDENCY_MISSING_INSTANCE",
            `Indicator ${node.instanceId} input ${inputKey} references missing instance ${binding.instanceId}.`,
          );
        }
        if (binding.instanceId === node.instanceId) {
          throw new IndicatorDependencyGraphError(
            "INDICATOR_DEPENDENCY_SELF_REFERENCE",
            `Indicator ${node.instanceId} input ${inputKey} cannot reference itself.`,
          );
        }
        if (
          !outputKeysByInstanceId
            .get(binding.instanceId)
            ?.has(binding.outputKey)
        ) {
          throw new IndicatorDependencyGraphError(
            "INDICATOR_DEPENDENCY_MISSING_OUTPUT",
            `Indicator ${node.instanceId} input ${inputKey} references missing output ${binding.outputKey} on ${binding.instanceId}.`,
          );
        }
        dependencies.add(binding.instanceId);
        return Object.freeze({
          inputKey,
          instanceId: binding.instanceId,
          outputKey: binding.outputKey,
        });
      });
    dependenciesById.set(node.instanceId, dependencies);
    bindingsByInstanceId.set(node.instanceId, Object.freeze(bindings));
    for (const dependencyId of dependencies) {
      const dependents = dependentsById.get(dependencyId) ?? new Set<string>();
      dependents.add(node.instanceId);
      dependentsById.set(dependencyId, dependents);
    }
  }

  const orderIndex = (instanceId: string): number =>
    byId.get(instanceId)?.index ?? Number.MAX_SAFE_INTEGER;
  let current = nodes
    .filter((node) => (dependenciesById.get(node.instanceId)?.size ?? 0) === 0)
    .map((node) => node.instanceId);
  const remainingDependencies = new Map(
    [...dependenciesById].map(([instanceId, dependencies]) => [
      instanceId,
      dependencies.size,
    ]),
  );
  const layers: string[][] = [];
  const orderedInstanceIds: string[] = [];

  while (current.length > 0) {
    current.sort((left, right) => orderIndex(left) - orderIndex(right));
    const layer = [...current];
    layers.push(layer);
    orderedInstanceIds.push(...layer);
    const next = new Set<string>();
    for (const instanceId of layer) {
      for (const dependentId of dependentsById.get(instanceId) ?? []) {
        const count = (remainingDependencies.get(dependentId) ?? 0) - 1;
        remainingDependencies.set(dependentId, count);
        if (count === 0) next.add(dependentId);
      }
    }
    current = [...next];
  }

  if (orderedInstanceIds.length !== nodes.length) {
    const ordered = new Set(orderedInstanceIds);
    const cyclic = nodes
      .map((node) => node.instanceId)
      .filter((instanceId) => !ordered.has(instanceId));
    throw new IndicatorDependencyGraphError(
      "INDICATOR_DEPENDENCY_CYCLE",
      `Indicator dependency graph contains a cycle involving ${cyclic.join(", ")}.`,
    );
  }

  return Object.freeze({
    layers: Object.freeze(layers.map((layer) => Object.freeze(layer))),
    orderedInstanceIds: Object.freeze(orderedInstanceIds),
    bindingsByInstanceId,
  });
}
