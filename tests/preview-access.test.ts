import { describe, expect, it } from "vitest";
import { describeAccess, formatBrusselsDateTime, summarizeAccess } from "@/lib/preview/access-activity";

const never = { first_accessed_at: null, last_accessed_at: null, successful_access_count: 0 };
const viewed = { first_accessed_at: "2026-11-01T13:32:00Z", last_accessed_at: "2026-11-03T09:05:00Z", successful_access_count: 4 };

describe("preview access summary", () => {
  it("shows 'Never viewed' with no dates when there has been no successful unlock", () => {
    expect(summarizeAccess(never)).toEqual({ viewed: false, label: "Never viewed", count: 0 });
    expect(describeAccess(never)).toBe("Not viewed yet");
  });

  it("never invents a date: a count without a timestamp still reads as never viewed", () => {
    expect(summarizeAccess({ ...never, successful_access_count: 3 }).viewed).toBe(false);
  });

  it("shows first, last and the number of successful unlocks", () => {
    expect(summarizeAccess(viewed)).toEqual({ viewed: true, label: "Viewed", first: viewed.first_accessed_at, last: viewed.last_accessed_at, count: 4 });
  });

  it("formats in Europe/Brussels (CET in winter, CEST in summer)", () => {
    expect(formatBrusselsDateTime("2026-11-01T13:32:00Z")).toBe("1 Nov 2026, 14:32");
    expect(formatBrusselsDateTime("2026-07-01T12:00:00Z")).toBe("1 Jul 2026, 14:00");
    expect(formatBrusselsDateTime("2026-10-31T23:30:00Z")).toBe("1 Nov 2026, 00:30");
    expect(describeAccess({ ...viewed, last_accessed_at: "2026-11-01T13:32:00Z" })).toBe("Viewed 1 Nov 2026 at 14:32");
  });
});
