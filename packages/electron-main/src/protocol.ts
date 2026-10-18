import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isPluginId,
  isPluginPackagePath,
  isPluginVersion,
} from "@erc-chart/contracts";

export const rendererProtocolScheme = "erc-app";
export const rendererEntryUrl = "erc-app://app/index.html";
export const indicatorPluginProtocolScheme = "erc-plugin";
export const indicatorPluginOrigin = "erc-plugin://plugin";

export interface RendererSchemeRegistration {
  readonly scheme: string;
  readonly privileges: {
    readonly standard: true;
    readonly secure: true;
    readonly supportFetchAPI: true;
    readonly corsEnabled?: true;
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

export const indicatorPluginSchemeRegistration: RendererSchemeRegistration = {
  scheme: indicatorPluginProtocolScheme,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
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

export function resolveIndicatorPluginAssetUrl(
  requestUrl: string,
  installationRoot: string,
): string | undefined {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== `${indicatorPluginProtocolScheme}:` ||
    url.hostname.toLowerCase() !== "plugin" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return undefined;
  }
  const encodedPathname = rawPathname(requestUrl);
  if (encodedPathname === undefined || /%2e/iu.test(encodedPathname)) {
    return undefined;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(encodedPathname);
  } catch {
    return undefined;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return undefined;
  const segments = pathname.split("/").filter(Boolean);
  const [pluginId, version, ...entrySegments] = segments;
  const entryPath = entrySegments.join("/");
  if (
    pluginId === undefined ||
    version === undefined ||
    !isPluginId(pluginId) ||
    !isPluginVersion(version) ||
    !entryPath.startsWith("dist/") ||
    !isPluginPackagePath(entryPath)
  ) {
    return undefined;
  }
  const root = path.resolve(installationRoot);
  const versionRoot = path.resolve(root, pluginId, version);
  const target = path.resolve(versionRoot, ...entrySegments);
  const lexicalRelative = path.relative(versionRoot, target);
  if (!isContainedRelativePath(lexicalRelative)) return undefined;

  try {
    const canonicalRoot = realpathSync.native(root);
    const canonicalVersionRoot = realpathSync.native(versionRoot);
    const canonicalTarget = realpathSync.native(target);
    if (
      !isContainedRelativePath(
        path.relative(canonicalRoot, canonicalVersionRoot),
      ) ||
      !isContainedRelativePath(
        path.relative(canonicalVersionRoot, canonicalTarget),
      ) ||
      !statSync(canonicalTarget).isFile()
    ) {
      return undefined;
    }
    return pathToFileURL(canonicalTarget).href;
  } catch {
    return undefined;
  }
}

function isContainedRelativePath(relative: string): boolean {
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
