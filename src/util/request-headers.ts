/** Merge HTTP header maps for runtime probes; later maps override earlier keys. */
export function mergeAuthHeaders(
  base: Record<string, string> | undefined,
  override: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const merged = { ...(base ?? {}), ...(override ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
