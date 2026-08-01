import { isRuntimeInfo, type RuntimeInfo } from "@erc-chart/contracts";

export interface RendererBridge {
  readonly getRuntimeInfo: () => Promise<RuntimeInfo>;
}

function appendTextElement(
  document: Document,
  parent: Element,
  tagName: string,
  text: string,
  attribute?: string,
): HTMLElement {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (attribute !== undefined) element.setAttribute(attribute, "");
  parent.append(element);
  return element;
}

export async function renderDevelopmentShell(
  document: Document,
  bridge: RendererBridge | undefined,
): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) throw new Error("Renderer root unavailable.");

  root.replaceChildren();
  const shell = document.createElement("section");
  shell.setAttribute("aria-labelledby", "product-name");
  root.append(shell);
  const title = appendTextElement(document, shell, "h1", "ERC Chart");
  title.id = "product-name";
  appendTextElement(
    document,
    shell,
    "p",
    "Development shell",
    "data-milestone",
  );
  const status = appendTextElement(
    document,
    shell,
    "p",
    "Connecting secure bridge",
    "data-status",
  );
  const message = appendTextElement(document, shell, "p", "", "data-message");

  try {
    const runtimeInfo = await bridge?.getRuntimeInfo();
    if (!isRuntimeInfo(runtimeInfo)) throw new Error("Invalid bridge result.");
    status.textContent = "Secure bridge connected";
  } catch {
    status.textContent = "Shell unavailable";
    message.textContent = "The secure application bridge could not be reached.";
  }
}
