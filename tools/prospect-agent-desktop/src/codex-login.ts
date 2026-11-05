/**
 * "Open Codex Login": the tray app never signs in to ChatGPT itself and never reads Codex's credential files. It only opens a terminal window
 * running `codex login`, where Codex (which owns authentication) does the sign-in. The command line is assembled from a path this agent already
 * resolved (never from user text), and is refused outright if the path contains anything cmd.exe would treat specially.
 */
const UNSAFE = /["%^&|<>()!\r\n]/;

export function codexLoginCommand(exePath: string | null, comspec = "cmd.exe"): { cmd: string; args: string[] } | null {
  if (!exePath || UNSAFE.test(exePath)) return null;
  const quoted = /\s/.test(exePath) ? `"${exePath}"` : exePath;
  // `cmd /s /c "<line>"` strips the outer quotes; `start` opens a NEW visible console, and /k keeps it open so the person can read the result.
  const line = `start "Codex sign-in" cmd.exe /d /k "${quoted} login"`;
  return { cmd: comspec, args: ["/d", "/s", "/c", `"${line}"`] };
}
