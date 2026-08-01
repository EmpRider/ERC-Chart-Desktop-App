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
    readonly codeCache: true;
  };
}

export const rendererSchemeRegistration: RendererSchemeRegistration = {
  scheme: rendererProtocolScheme,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    codeCache: true,
  },
};

function rawPathname(requestUrl: string): string | undefined {
  const match = /^erc-app:\/\/app(?<pathname>\/[^?#]*)?(?:[?#]|$)/u.exec(
    requestUrl,
  );
  return match?.groups?.pathname ?? "/";
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
  if (url.protocol !== `${rendererProtocolScheme}:` || url.host !== "app") {
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
