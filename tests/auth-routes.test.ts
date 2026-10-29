import { describe, expect, it } from "vitest";
import {
  decideAdminRoute,
  isAdminPath,
  isLoginPath,
  isRecoveryPath,
  isSupabaseAuthCookie,
} from "@/lib/auth-routes";

describe("admin route rules", () => {
  it("recognises admin and login paths (and not look-alikes)", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/projects/1")).toBe(true);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath("/work/admin")).toBe(false);
    expect(isLoginPath("/admin/login")).toBe(true);
    expect(isLoginPath("/admin/login/x")).toBe(true);
    expect(isLoginPath("/admin/loginx")).toBe(false);
  });

  it("sends visitors without a session to the login page", () => {
    for (const path of ["/admin", "/admin/projects", "/admin/projects/new", "/admin/inquiries/1"]) {
      expect(decideAdminRoute(path, false)).toBe("to-login");
    }
  });

  it("lets the login page render for visitors without a session", () => {
    expect(decideAdminRoute("/admin/login", false)).toBe("allow");
  });

  it("verifies admin membership before redirecting signed-in users away from login", () => {
    expect(decideAdminRoute("/admin/login", true)).toBe("check-admin-then-home");
  });

  it("allows signed-in users into the panel (membership is re-checked server-side)", () => {
    expect(decideAdminRoute("/admin/projects", true)).toBe("allow");
  });

  it("lets the recovery pages render with or without a session", () => {
    for (const path of ["/admin/forgot-password", "/admin/reset-password"]) {
      expect(decideAdminRoute(path, false)).toBe("allow");
      expect(decideAdminRoute(path, true)).toBe("allow");
    }
    expect(isRecoveryPath("/admin/reset-passwordx")).toBe(false);
  });

  it("recognises session cookies but never the PKCE verifier", () => {
    expect(isSupabaseAuthCookie("sb-abcd-auth-token")).toBe(true);
    expect(isSupabaseAuthCookie("sb-abcd-auth-token.1")).toBe(true);
    expect(isSupabaseAuthCookie("sb-abcd-auth-token-code-verifier")).toBe(false);
    expect(isSupabaseAuthCookie("theme")).toBe(false);
  });

  it("ignores public routes", () => {
    expect(decideAdminRoute("/work", false)).toBe("allow");
    expect(decideAdminRoute("/", true)).toBe("allow");
  });
});
