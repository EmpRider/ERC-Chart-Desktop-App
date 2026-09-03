export function requireProviderProfileId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 128
  ) {
    throw new RangeError("Provider profile ID is required.");
  }
  return value;
}
