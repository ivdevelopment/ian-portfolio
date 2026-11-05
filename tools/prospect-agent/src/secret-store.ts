import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentHome } from "./paths";

/**
 * Where the CRM connection token is kept on this PC. On Windows it is encrypted with DPAPI for the CURRENT USER (the same mechanism Windows uses
 * for saved credentials): the file holds ciphertext that only this Windows account on this machine can open. The secret is handed to PowerShell
 * over stdin, never as a command-line argument, so it does not appear in a process list. Nothing is written to a repository, and the token is
 * never logged. `PROSPECT_AGENT_TOKEN` can be set instead (development and tests).
 *
 * This file only ever stores the CRM connection token. It does not read, copy or move any Codex or ChatGPT credential.
 */
const PROTECT = "Add-Type -AssemblyName System.Security; $t = [Console]::In.ReadToEnd().Trim(); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($t), $null, 'CurrentUser'))";
const UNPROTECT = "Add-Type -AssemblyName System.Security; $t = [Console]::In.ReadToEnd().Trim(); [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($t), $null, 'CurrentUser'))";

function powershell(script: string, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error("secure storage failed"))));
    child.stdin.end(stdin);
  });
}

const tokenFile = (home: string) => join(home, "token.dpapi");

export async function saveToken(token: string, home = agentHome()): Promise<void> {
  if (process.platform !== "win32") throw new Error("Secure token storage is built for Windows. On other systems set PROSPECT_AGENT_TOKEN instead.");
  mkdirSync(home, { recursive: true });
  writeFileSync(tokenFile(home), await powershell(PROTECT, token), { encoding: "utf8", mode: 0o600 });
}

export async function loadToken(home = agentHome(), env: Record<string, string | undefined> = process.env): Promise<string | null> {
  if (env.PROSPECT_AGENT_TOKEN) return env.PROSPECT_AGENT_TOKEN.trim();
  const file = tokenFile(home);
  if (process.platform !== "win32" || !existsSync(file)) return null;
  try {
    return await powershell(UNPROTECT, readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function forgetToken(home = agentHome()): boolean {
  const file = tokenFile(home);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}
