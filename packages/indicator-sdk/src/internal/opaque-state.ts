const opaqueStateValues = new WeakSet<object>();

/** Marks an SDK-owned value whose reference identity must survive state cloning. */
export function markOpaqueStateValue<T extends object>(value: T): T {
  opaqueStateValues.add(value);
  return value;
}

/** Returns true for SDK-owned values that persistent state must retain by identity. */
export function isOpaqueStateValue(value: object): boolean {
  return opaqueStateValues.has(value);
}
