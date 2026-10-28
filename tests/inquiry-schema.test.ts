import { describe, expect, it } from "vitest";
import { inquirySchema } from "@/lib/schemas/inquiry";

const base = {
  name: "Test Person",
  email: "test@example.com",
  projectType: "New website",
  budget: "€1,000 – €2,500",
  message: "I need a new website for my small business.",
};

describe("inquirySchema", () => {
  it("accepts a valid inquiry", () => {
    expect(inquirySchema.safeParse(base).success).toBe(true);
  });

  it("trims and validates the email", () => {
    expect(inquirySchema.safeParse({ ...base, email: "  a@b.co " }).success).toBe(true);
    expect(inquirySchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
  });

  it("enforces length limits", () => {
    expect(inquirySchema.safeParse({ ...base, name: "A" }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...base, message: "too short" }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...base, message: "x".repeat(4001) }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...base, name: "x".repeat(121) }).success).toBe(false);
  });

  it("only accepts the known project types and budgets", () => {
    expect(inquirySchema.safeParse({ ...base, projectType: "Hack" }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...base, budget: "€1" }).success).toBe(false);
  });

  it("rejects a filled honeypot", () => {
    expect(inquirySchema.safeParse({ ...base, company: "Spam Inc" }).success).toBe(false);
    expect(inquirySchema.safeParse({ ...base, company: "" }).success).toBe(true);
  });
});
