export function isProviderNetworkRequestAllowed(
  requestUrl: string,
  permissions: readonly string[],
): boolean {
  let target: URL;
  try {
    target = new URL(requestUrl);
  } catch {
    return false;
  }
  if (target.protocol !== "https:" && target.protocol !== "wss:") return false;
  return permissions.some((permission) => {
    try {
      const allowed = new URL(permission);
      if (
        allowed.protocol !== target.protocol ||
        allowed.origin !== target.origin
      ) {
        return false;
      }
      const pathMatches =
        target.pathname === allowed.pathname ||
        (allowed.pathname.endsWith("/")
          ? target.pathname.startsWith(allowed.pathname)
          : target.pathname.startsWith(`${allowed.pathname}/`));
      if (!pathMatches) return false;
      if (allowed.search !== "" && allowed.search !== target.search)
        return false;
      return true;
    } catch {
      return false;
    }
  });
}
