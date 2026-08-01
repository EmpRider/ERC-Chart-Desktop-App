import path from "node:path";
import { pathToFileURL } from "node:url";

export const rendererProtocolScheme = "erc-app";
export const rendererEntryUrl = "erc-app://app/index.html";

export interface RendererSchemeRegistration {
  readonly scheme: string;
  readonly privileges: {
    readonly standard: true;
    readonly secure: true;
    readonly supportFetchAPI: true;
  };
}

export const rendererSchemeRegistration: RendererSchemeRegistration = {
  scheme: rendererProtocolScheme,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
  },
};

function rawPathname(requestUrl: string): string | undefined {
  const authorityStart = requestUrl.indexOf("://");
  if (authorityStart === -1) return undefined;
  const contentStart = authorityStart + 3;
  const pathnameStart = requestUrl.indexOf("/", contentStart);
  const queryStart = requestUrl.indexOf("?", contentStart);
  const fragmentStart = requestUrl.indexOf("#", contentStart);
  const suffixStarts = [queryStart, fragmentStart].filter(
    (index) => index !== -1,
  );
  const firstSuffix =
    suffixStarts.length === 0 ? -1 : Math.min(...suffixStarts);
  if (
    pathnameStart === -1 ||
    (firstSuffix !== -1 && firstSuffix < pathnameStart)
  ) {
    return "/";
  }
  const pathnameSuffixes = suffixStarts.filter(
    (index) => index > pathnameStart,
  );
  const pathnameEnd =
    pathnameSuffixes.length === 0
      ? requestUrl.length
      : Math.min(...pathnameSuffixes);
  return requestUrl.slice(pathnameStart, pathnameEnd);
}

export function resolveRendererAssetUrl(
  requestUrl: string,
  rootPath: string,
): string | undefined {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== `${rendererProtocolScheme}:` ||
    url.hostname.toLowerCase() !== "app" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return undefined;
  }

  const encodedPathname = rawPathname(requestUrl);
  if (
    encodedPathname === undefined ||
    /%2e/iu.test(encodedPathname) ||
    encodedPathname.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(encodedPathname);
  } catch {
    return undefined;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return undefined;

  const root = path.resolve(rootPath);
  const target = path.resolve(root, ...pathname.split("/").filter(Boolean));
  const relative = path.relative(root, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return pathToFileURL(target).href;
}
