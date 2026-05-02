import { describe, it, expect } from "vitest";
import { buildStateGuard } from "../scrapers/local-sources";

describe("buildStateGuard", () => {
  it("returns null for non-US cities", () => {
    expect(buildStateGuard({ country: "United Kingdom", clinicalName: "Birmingham, West Midlands" })).toBeNull();
    expect(buildStateGuard({ country: "Japan", clinicalName: undefined })).toBeNull();
  });

  it("returns null for US cities without a comma in clinicalName", () => {
    expect(buildStateGuard({ country: "United States", clinicalName: "Boston" })).toBeNull();
    expect(buildStateGuard({ country: "United States", clinicalName: undefined })).toBeNull();
  });

  it("extracts state name for US cities with disambiguated clinicalName", () => {
    expect(buildStateGuard({ country: "United States", clinicalName: "Birmingham, Alabama" })).toBe("Alabama");
    expect(buildStateGuard({ country: "United States", clinicalName: "Oxford, Mississippi" })).toBe("Mississippi");
    expect(buildStateGuard({ country: "United States", clinicalName: "Springfield, Illinois" })).toBe("Illinois");
  });

  it("trims whitespace from extracted state name", () => {
    // Extra spaces around the comma should still produce a clean result
    const result = buildStateGuard({ country: "United States", clinicalName: "Memphis,  Tennessee" });
    expect(result).toBe("Tennessee");
  });
});
