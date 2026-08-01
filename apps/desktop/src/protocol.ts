import {
  rendererProtocolScheme,
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
): Promise<() => void> {
  await adapters.handle(rendererProtocolScheme, async (request) => {
    const assetUrl = resolveRendererAssetUrl(request.url, rootPath);
    if (assetUrl === undefined) return new Response(null, { status: 404 });
    try {
      return await adapters.fetch(assetUrl);
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  let installed = true;
  return (): void => {
    if (!installed) return;
    installed = false;
    adapters.unhandle(rendererProtocolScheme);
  };
}
