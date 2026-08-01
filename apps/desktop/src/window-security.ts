import { isTrustedRendererDocument } from "@erc-chart/electron-main";

interface NavigationEvent {
  readonly preventDefault: () => void;
}

interface WindowSecurityAdapter {
  readonly onWillNavigate: (
    handler: (event: NavigationEvent, url: string) => void,
  ) => void;
  readonly setWindowOpenHandler: (
    handler: () => { readonly action: "deny" },
  ) => void;
}

export function installWindowSecurity(adapter: WindowSecurityAdapter): void {
  adapter.onWillNavigate((event, url) => {
    if (!isTrustedRendererDocument(url)) event.preventDefault();
  });
  adapter.setWindowOpenHandler(() => ({ action: "deny" }));
}
