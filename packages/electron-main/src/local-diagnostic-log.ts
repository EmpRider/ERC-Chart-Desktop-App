import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

const redacted = "[REDACTED]";
const normalizedSecretKeys = new Set([
  "apikey",
  "authorization",
  "authorizationheader",
  "authtoken",
  "accesstoken",
  "clientsecret",
  "cookie",
  "deviceid",
  "deviceidentifier",
  "password",
  "rawframe",
  "rawproviderframe",
  "secret",
  "token",
]);
const secretQueryPattern =
  /^(api_key|apikey|authorization|cookie|password|secret|token|access_token|auth_token|authtoken|device_id|deviceid)$/i;
const codePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const levels = new Set<DiagnosticLevel>(["debug", "info", "warn", "error"]);
const defaultMaxBytes = 5 * 1_024 * 1_024;
const defaultMaxFiles = 5;
const maximumMetadataBytes = 64 * 1_024;

export type DiagnosticLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticMetadata = Readonly<Record<string, unknown>>;

export interface DiagnosticEvent {
  readonly level: DiagnosticLevel;
  readonly code: string;
  readonly metadata: DiagnosticMetadata;
}

export interface LocalDiagnosticLog {
  readonly write: (event: DiagnosticEvent) => Promise<void>;
}

export interface LocalDiagnosticLogOptions {
  readonly directory: string;
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly now?: () => Date;
}

function requireInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  )
    throw new Error(`Invalid diagnostic log ${field}.`);
  return resolved;
}

function redactString(value: string): string {
  let result = value
    .replace(/(\bauthorization\s*:\s*)[^\r\n]+/gi, `$1${redacted}`)
    .replace(/(\bcookie\s*:\s*)[^\r\n]+/gi, `$1${redacted}`);
  try {
    const url = new URL(result);
    if (url.protocol !== "http:" && url.protocol !== "https:") return result;
    for (const key of url.searchParams.keys()) {
      if (secretQueryPattern.test(key)) url.searchParams.set(key, redacted);
    }
    result = url.toString();
  } catch {
    // Ordinary metadata strings are not URLs.
  }
  return result;
}

function redactValue(
  value: unknown,
  key = "",
  seen = new Set<object>(),
): unknown {
  if (normalizedSecretKeys.has(key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase()))
    return redacted;
  if (typeof value === "string") return redactString(value);
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return value;
  if (typeof value !== "object")
    throw new Error("Invalid diagnostic metadata.");
  if (seen.has(value)) throw new Error("Invalid diagnostic metadata.");
  seen.add(value);
  try {
    if (Array.isArray(value))
      return value.map((item) => redactValue(item, "", seen));
    if (Object.getPrototypeOf(value) !== Object.prototype)
      throw new Error("Invalid diagnostic metadata.");
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        redactValue(item, name, seen),
      ]),
    );
  } finally {
    seen.delete(value);
  }
}

function serializeEvent(event: DiagnosticEvent, now: () => Date): string {
  if (!levels.has(event.level)) throw new Error("Invalid diagnostic level.");
  if (typeof event.code !== "string" || !codePattern.test(event.code))
    throw new Error("Invalid diagnostic code.");
  if (
    event.metadata === null ||
    typeof event.metadata !== "object" ||
    Array.isArray(event.metadata) ||
    Object.getPrototypeOf(event.metadata) !== Object.prototype
  )
    throw new Error("Invalid diagnostic metadata.");
  const metadata = redactValue(event.metadata);
  const metadataJson = JSON.stringify(metadata);
  if (Buffer.byteLength(metadataJson, "utf8") > maximumMetadataBytes)
    throw new Error("Diagnostic metadata is too large.");
  const occurredAt = now();
  if (!(occurredAt instanceof Date) || !Number.isFinite(occurredAt.getTime()))
    throw new Error("Invalid diagnostic timestamp.");
  return `${JSON.stringify({
    occurredAt: occurredAt.toISOString(),
    level: event.level,
    code: event.code,
    metadata,
  })}\n`;
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function moveIfPresent(
  source: string,
  destination: string,
): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function rotate(file: string, maxFiles: number): Promise<void> {
  if (maxFiles === 1) {
    await rm(file, { force: true });
    return;
  }
  for (let generation = maxFiles - 1; generation >= 1; generation -= 1) {
    const source = generation === 1 ? file : `${file}.${generation - 1}`;
    const destination = `${file}.${generation}`;
    await rm(destination, { force: true });
    await moveIfPresent(source, destination);
  }
}

export function createLocalDiagnosticLog(
  options: LocalDiagnosticLogOptions,
): LocalDiagnosticLog {
  if (
    typeof options.directory !== "string" ||
    options.directory.trim() === "" ||
    !path.isAbsolute(options.directory)
  )
    throw new Error("Diagnostic log directory must be absolute.");
  const maxBytes = requireInteger(
    options.maxBytes,
    defaultMaxBytes,
    128,
    100 * 1_024 * 1_024,
    "maximum size",
  );
  const maxFiles = requireInteger(
    options.maxFiles,
    defaultMaxFiles,
    1,
    20,
    "file count",
  );
  const now = options.now ?? (() => new Date());
  const file = path.join(options.directory, "erc-chart.log");
  let pending = Promise.resolve();

  return {
    write: (event): Promise<void> => {
      let line: string;
      try {
        line = serializeEvent(event, now);
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (lineBytes > maxBytes)
        return Promise.reject(
          new Error("Diagnostic event exceeds log size limit."),
        );
      const operation = pending.then(async () => {
        await mkdir(options.directory, { recursive: true });
        const size = await fileSize(file);
        if (size > 0 && size + lineBytes > maxBytes)
          await rotate(file, maxFiles);
        await appendFile(file, line, { encoding: "utf8", mode: 0o600 });
      });
      pending = operation.catch(() => undefined);
      return operation;
    },
  };
}
