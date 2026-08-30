import { describe, expect, it } from "vitest";
import { isValidCityKey, normalizeCityKey } from "./city-key";

describe("normalizeCityKey", () => {
  it("maps Chinese labels to canonical keys", () => {
    expect(normalizeCityKey("河内")).toBe("hanoi");
    expect(normalizeCityKey("胡志明市")).toBe("hcmc");
    expect(normalizeCityKey("岘港")).toBe("danang");
  });

  it("maps English / historical aliases to canonical keys", () => {
    expect(normalizeCityKey("hn")).toBe("hanoi");
    expect(normalizeCityKey("Hanoi")).toBe("hanoi");
    expect(normalizeCityKey("HANOI")).toBe("hanoi");
    expect(normalizeCityKey("hcmc")).toBe("hcmc");
    expect(normalizeCityKey("HCM")).toBe("hcmc");
    expect(normalizeCityKey("Saigon")).toBe("hcmc");
    expect(normalizeCityKey("danang")).toBe("danang");
    expect(normalizeCityKey("Da Nang")).toBe("danang");
  });

  it("returns empty for empty / whitespace / unknown input", () => {
    expect(normalizeCityKey("")).toBe("");
    expect(normalizeCityKey("   ")).toBe("");
    expect(normalizeCityKey(undefined)).toBe("");
    expect(normalizeCityKey(null)).toBe("");
    expect(normalizeCityKey("Atlantis")).toBe("");
    expect(normalizeCityKey("河外")).toBe("");
  });

  it("trims whitespace before lookup", () => {
    expect(normalizeCityKey("  河内  ")).toBe("hanoi");
  });
});

describe("isValidCityKey", () => {
  it("accepts only known canonical keys", () => {
    expect(isValidCityKey("hanoi")).toBe(true);
    expect(isValidCityKey("hcmc")).toBe(true);
    expect(isValidCityKey("danang")).toBe(true);
  });
  it("rejects unknown / empty / alias", () => {
    expect(isValidCityKey("")).toBe(false);
    expect(isValidCityKey("河内")).toBe(false);
    expect(isValidCityKey("hn")).toBe(false);
    expect(isValidCityKey("Saigon")).toBe(false);
  });
});
