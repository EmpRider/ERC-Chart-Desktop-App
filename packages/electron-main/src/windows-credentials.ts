import { spawn } from "node:child_process";
import process from "node:process";

const targetPattern = /^ERC-chart\/provider\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const maximumSecretBytes = 2_560;

// ponytail: PowerShell hosts P/Invoke; replace it with a signed native helper if deployment policy blocks it.

export type WindowsCredentialBridgeRequest =
  | {
      readonly operation: "write";
      readonly target: string;
      readonly secret: string;
    }
  | { readonly operation: "read"; readonly target: string }
  | { readonly operation: "delete"; readonly target: string };

export interface WindowsCredentialBridgeResponse {
  readonly ok?: boolean;
  readonly found?: boolean;
  readonly deleted?: boolean;
  readonly secret?: string;
}

export interface WindowsGenericCredentialManager {
  readonly write: (target: string, secret: string) => Promise<void>;
  readonly read: (target: string) => Promise<string | undefined>;
  readonly delete: (target: string) => Promise<boolean>;
}

export interface WindowsGenericCredentialManagerOptions {
  readonly platform?: string;
  readonly run?: (
    request: WindowsCredentialBridgeRequest,
  ) => Promise<WindowsCredentialBridgeResponse>;
}

const bridgeScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class ErcChartCredentialManager {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct Credential {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref Credential credential, UInt32 flags);

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);

  [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, UInt32 type, UInt32 flags);

  [DllImport("advapi32.dll", EntryPoint = "CredFree")]
  public static extern void CredFree(IntPtr buffer);
}
'@

$request = ([Console]::In.ReadToEnd() | ConvertFrom-Json)
$type = [UInt32]1
$notFound = 1168

switch ($request.operation) {
  'write' {
    $bytes = [Text.Encoding]::UTF8.GetBytes([string]$request.secret)
    $blob = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
      $credential = New-Object ErcChartCredentialManager+Credential
      $credential.Type = $type
      $credential.TargetName = [string]$request.target
      $credential.CredentialBlobSize = [UInt32]$bytes.Length
      $credential.CredentialBlob = $blob
      $credential.Persist = [UInt32]2
      $credential.UserName = 'ERC Chart'
      if (-not [ErcChartCredentialManager]::CredWrite([ref]$credential, 0)) { exit 1 }
      @{ ok = $true } | ConvertTo-Json -Compress
    } finally {
      if ($bytes.Length -gt 0) {
        for ($index = 0; $index -lt $bytes.Length; $index++) {
          [Runtime.InteropServices.Marshal]::WriteByte($blob, $index, 0)
        }
      }
      [Runtime.InteropServices.Marshal]::FreeHGlobal($blob)
      [Array]::Clear($bytes, 0, $bytes.Length)
    }
  }
  'read' {
    $pointer = [IntPtr]::Zero
    if (-not [ErcChartCredentialManager]::CredRead([string]$request.target, $type, 0, [ref]$pointer)) {
      if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq $notFound) {
        @{ found = $false } | ConvertTo-Json -Compress
        break
      }
      exit 1
    }
    try {
      $credential = [Runtime.InteropServices.Marshal]::PtrToStructure(
        $pointer,
        [type][ErcChartCredentialManager+Credential]
      )
      $bytes = New-Object byte[] $credential.CredentialBlobSize
      [Runtime.InteropServices.Marshal]::Copy(
        $credential.CredentialBlob,
        $bytes,
        0,
        $credential.CredentialBlobSize
      )
      try {
        $utf8 = New-Object Text.UTF8Encoding($false, $true)
        @{ found = $true; secret = $utf8.GetString($bytes) } |
          ConvertTo-Json -Compress
      } finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
      }
    } finally {
      [ErcChartCredentialManager]::CredFree($pointer)
    }
  }
  'delete' {
    if ([ErcChartCredentialManager]::CredDelete([string]$request.target, $type, 0)) {
      @{ deleted = $true } | ConvertTo-Json -Compress
      break
    }
    if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq $notFound) {
      @{ deleted = $false } | ConvertTo-Json -Compress
      break
    }
    exit 1
  }
  default { exit 1 }
}
`;

function requireTarget(target: unknown): string {
  if (
    typeof target !== "string" ||
    target.length > 320 ||
    !targetPattern.test(target)
  )
    throw new Error("Invalid Windows credential target.");
  return target;
}

function requireSecret(secret: unknown): string {
  if (
    typeof secret !== "string" ||
    secret.length === 0 ||
    Buffer.byteLength(secret, "utf8") > maximumSecretBytes
  )
    throw new Error(
      `Credential secret must contain between 1 and ${maximumSecretBytes} UTF-8 bytes.`,
    );
  return secret;
}

function requireSegment(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+$/.test(value))
    throw new Error(`Invalid credential ${field}.`);
  return value;
}

export function windowsCredentialTarget(
  providerId: string,
  profileId: string,
): string {
  const target = `ERC-chart/provider/${requireSegment(
    providerId,
    "provider ID",
  )}/${requireSegment(profileId, "profile ID")}`;
  return requireTarget(target);
}

async function runPowerShellBridge(
  request: WindowsCredentialBridgeRequest,
): Promise<WindowsCredentialBridgeResponse> {
  const encodedScript = Buffer.from(bridgeScript, "utf16le").toString("base64");
  return await new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encodedScript,
      ],
      { shell: false, stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    );
    let output = "";
    let settled = false;
    const finishWithError = (): void => {
      if (settled) return;
      settled = true;
      reject(new Error("Windows Credential Manager operation failed."));
    };
    const timeout = setTimeout(() => {
      child.kill();
      finishWithError();
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 32_768) child.kill();
    });
    child.on("error", finishWithError);
    child.stdin.on("error", finishWithError);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (settled) return;
      if (code !== 0 || output.length > 32_768) {
        finishWithError();
        return;
      }
      try {
        const parsed: unknown = JSON.parse(output);
        if (typeof parsed !== "object" || parsed === null) {
          finishWithError();
          return;
        }
        settled = true;
        resolve(parsed as WindowsCredentialBridgeResponse);
      } catch {
        finishWithError();
      }
    });
    child.stdin.end(JSON.stringify(request), "utf8");
  });
}

export function createWindowsGenericCredentialManager(
  options: WindowsGenericCredentialManagerOptions = {},
): WindowsGenericCredentialManager {
  const platform = options.platform ?? process.platform;
  const run = options.run ?? runPowerShellBridge;

  const execute = async (
    request: WindowsCredentialBridgeRequest,
  ): Promise<WindowsCredentialBridgeResponse> => {
    if (platform !== "win32")
      throw new Error(
        "Windows Credential Manager is unavailable on this platform.",
      );
    try {
      return await run(request);
    } catch {
      throw new Error("Windows Credential Manager operation failed.");
    }
  };

  return {
    write: async (target, secret): Promise<void> => {
      const response = await execute({
        operation: "write",
        target: requireTarget(target),
        secret: requireSecret(secret),
      });
      if (response.ok !== true)
        throw new Error("Windows Credential Manager returned invalid data.");
    },
    read: async (target): Promise<string | undefined> => {
      const response = await execute({
        operation: "read",
        target: requireTarget(target),
      });
      if (response.found === false) return undefined;
      if (response.found !== true || typeof response.secret !== "string")
        throw new Error("Windows Credential Manager returned invalid data.");
      return response.secret;
    },
    delete: async (target): Promise<boolean> => {
      const response = await execute({
        operation: "delete",
        target: requireTarget(target),
      });
      if (typeof response.deleted !== "boolean")
        throw new Error("Windows Credential Manager returned invalid data.");
      return response.deleted;
    },
  };
}
