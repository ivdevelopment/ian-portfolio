import { describe, expect, it } from "vitest";
import { isPlaceholderEmail, publicEmail } from "@/lib/placeholder-email";

describe("placeholder email guard", () => {
  it("flags reserved example domains", () => {
    for (const e of ["hello@ianverlinden.example", "a@example.com", "a@mail.example.org", "a@x.test", "a@y.invalid"]) {
      expect(isPlaceholderEmail(e)).toBe(true);
      expect(publicEmail(e)).toBe("");
    }
  });

  it("keeps real addresses and tolerates empty values", () => {
    expect(publicEmail("ian@gmail.com")).toBe("ian@gmail.com");
    expect(publicEmail("hello@exampleco.be")).toBe("hello@exampleco.be");
    expect(publicEmail("")).toBe("");
    expect(publicEmail(null)).toBe("");
  });
});
