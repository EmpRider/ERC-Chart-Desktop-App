import { createHash } from "node:crypto";

const identityPrefix = "erc-v2";

function normalizedPart(value) {
  return String(value).replaceAll("\\", "/").trim();
}

export function semanticCallsiteKey({ sourceFileId, kind, callee, scope, anchor }) {
  return [
    identityPrefix,
    normalizedPart(sourceFileId),
    normalizedPart(kind),
    normalizedPart(callee),
    ...scope.map(normalizedPart),
    normalizedPart(anchor),
  ].join("\u001f");
}

export function stableCallsiteId(parts) {
  const key = semanticCallsiteKey(parts);
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `${identityPrefix}-${parts.kind}-${digest}`;
}
