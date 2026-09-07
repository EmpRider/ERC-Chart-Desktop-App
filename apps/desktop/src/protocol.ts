import {
  indicatorPluginProtocolScheme,
  indicatorWorkerContentSecurityPolicy,
  rendererProtocolScheme,
  resolveIndicatorPluginAssetUrl,
  resolveRendererAssetUrl,
} from "@erc-chart/electron-main";

export { rendererSchemeRegistration } from "@erc-chart/electron-main";

export interface RendererProtocolRequest {
  readonly url: string;
}

export interface RendererProtocolAdapters {
  readonly handle: (
    scheme: string,
    handler: (request: RendererProtocolRequest) => Promise<Response>,
  ) => void | Promise<void>;
  readonly unhandle: (scheme: string) => void;
  readonly fetch: (url: string) => Promise<Response>;
}

export async function installRendererProtocol(
  adapters: RendererProtocolAdapters,
  rootPath: string,
  indicatorPluginRootPath?: string,
): Promise<() => void> {
  let rendererInstalled = false;
  let pluginInstalled = false;
  try {
    await adapters.handle(rendererProtocolScheme, async (request) => {
      const assetUrl = resolveRendererAssetUrl(request.url, rootPath);
      if (assetUrl === undefined) return new Response(null, { status: 404 });
      try {
        const response = await adapters.fetch(assetUrl);
        const pathname = new URL(request.url).pathname;
        if (pathname !== "/indicator-worker.js") return response;
        return responseWithHeaders(response, {
          "Content-Security-Policy": indicatorWorkerContentSecurityPolicy,
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    rendererInstalled = true;

    if (indicatorPluginRootPath !== undefined) {
      await adapters.handle(indicatorPluginProtocolScheme, async (request) => {
        const assetUrl = resolveIndicatorPluginAssetUrl(
          request.url,
          indicatorPluginRootPath,
        );
        if (assetUrl === undefined) return new Response(null, { status: 404 });
        try {
          const response = await adapters.fetch(assetUrl);
          return responseWithHeaders(response, {
            "Access-Control-Allow-Origin": "erc-app://app",
            "Cross-Origin-Resource-Policy": "cross-origin",
          });
        } catch {
          return new Response(null, { status: 404 });
        }
      });
      pluginInstalled = true;
    }
  } catch (error) {
    if (pluginInstalled) adapters.unhandle(indicatorPluginProtocolScheme);
    if (rendererInstalled) adapters.unhandle(rendererProtocolScheme);
    throw error;
  }

  let installed = true;
  return (): void => {
    if (!installed) return;
    installed = false;
    if (rendererInstalled) adapters.unhandle(rendererProtocolScheme);
    if (pluginInstalled) {
      adapters.unhandle(indicatorPluginProtocolScheme);
    }
  };
}

function responseWithHeaders(
  response: Response,
  headers: Readonly<Record<string, string>>,
): Response {
  const merged = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers)) merged.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
