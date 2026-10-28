import { describe, expect, it } from "vitest";
import { isValidSlug, slugify, uniqueSlug } from "@/lib/slug";

describe("slugify", () => {
  it("lowercases, strips accents and collapses separators", () => {
    expect(slugify("Red Harbor — Studios!")).toBe("red-harbor-studios");
    expect(slugify("Café  Müller & Söhne")).toBe("cafe-muller-and-sohne");
    expect(slugify("  --Hello__World--  ")).toBe("hello-world");
  });

  it("never returns leading, trailing or doubled hyphens", () => {
    expect(slugify("***")).toBe("");
    expect(slugify("a---b")).toBe("a-b");
  });

  it("caps the length without leaving a trailing hyphen", () => {
    const slug = slugify(`${"word ".repeat(40)}`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("isValidSlug", () => {
  it.each(["a", "red-harbor-2", "x1"])("accepts %s", (s) => expect(isValidSlug(s)).toBe(true));
  it.each(["", "Upper", "has space", "-lead", "trail-", "dou--ble", "ünï", "a/b", "../x"])(
    "rejects %j",
    (s) => expect(isValidSlug(s)).toBe(false),
  );
});

describe("uniqueSlug", () => {
  it("returns the base when free", () => {
    expect(uniqueSlug("My Project", ["other"])).toBe("my-project");
  });
  it("appends the next free number on collision", () => {
    expect(uniqueSlug("My Project", ["my-project"])).toBe("my-project-2");
    expect(uniqueSlug("My Project", ["my-project", "my-project-2"])).toBe("my-project-3");
  });
  it("falls back to 'project' for empty input", () => {
    expect(uniqueSlug("!!!", [])).toBe("project");
  });
});
