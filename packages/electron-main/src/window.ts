export interface SecureWebPreferences {
  readonly preload: string;
  readonly nodeIntegration: false;
  readonly nodeIntegrationInWorker: false;
  readonly contextIsolation: true;
  readonly sandbox: true;
  readonly webSecurity: true;
}

export interface SecureWindowOptions {
  readonly width: number;
  readonly height: number;
  readonly show: false;
  readonly backgroundColor: string;
  readonly webPreferences: SecureWebPreferences;
}

export function secureWindowOptions(preloadPath: string): SecureWindowOptions {
  return {
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: "#111827",
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };
}
