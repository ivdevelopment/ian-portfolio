import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const desktop = join(process.cwd(), "tools", "prospect-agent-desktop");
const read = (...p: string[]) => readFileSync(join(desktop, ...p), "utf8");

describe("Windows packaging of Ian Prospect Agent", () => {
  it("builds a per-user installer that runs without elevation, with the right name, icon and shortcuts", () => {
    const pkg = JSON.parse(read("package.json")) as { build: { win: { requestedExecutionLevel: string }; nsis: Record<string, unknown> } };
    expect(pkg.build.win.requestedExecutionLevel).toBe("asInvoker");
    expect(pkg.build.nsis).toMatchObject({ perMachine: false, allowElevation: false, createStartMenuShortcut: true, deleteAppDataOnUninstall: false });
  });

  it("the installer is named, not published, and uses the site's own mark as its icon", () => {
    const pkg = JSON.parse(read("package.json")) as { build: { productName: string; executableName: string; publish?: unknown; win: { icon: string }; nsis: { artifactName: string; shortcutName: string } } };
    expect(pkg.build).toMatchObject({ productName: "Ian Prospect Agent", executableName: "Ian Prospect Agent" });
    expect(pkg.build.nsis).toMatchObject({ artifactName: "Ian Prospect Agent Setup.exe", shortcutName: "Ian Prospect Agent", createDesktopShortcut: true });
    expect(pkg.build.publish).toBeUndefined();
    expect(pkg.build.win.icon).toBe("assets/icon.ico");
  });
});
