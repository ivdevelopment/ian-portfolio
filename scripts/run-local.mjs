#!/usr/bin/env node
/**
 * Runs a command with the LOCAL Supabase environment (.env.supabase-local),
 * regardless of what .env.local points at (e.g. your hosted project).
 * Process env wins over Next's .env files, so the app talks to the local stack.
 *
 *   node scripts/run-local.mjs next dev
 *
 * Refuses to continue unless the URL is a loopback address.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const file = ".env.supabase-local";
if (!existsSync(file)) {
  console.error(`Missing ${file}. Start the local stack (npm run db:start) and create it from \`npx supabase status -o env\`.`);
  process.exit(1);
}
process.loadEnvFile(file);

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) {
  console.error(`${file} must point at the local Supabase stack (127.0.0.1). Refusing to continue.`);
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/run-local.mjs <command> [args…]");
  process.exit(1);
}

const bin = process.platform === "win32" && !command.includes(".") ? `${command}.cmd` : command;
const child = spawn(bin, args, { stdio: "inherit", env: process.env, shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
