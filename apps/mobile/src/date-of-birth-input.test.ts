import { describe, expect, it } from "vitest";
import { formatDateOfBirthInput, getDateOfBirthError } from "./date-of-birth-input";

describe("AUTH-DOB-FORMAT-001 registration date input", () => {
  it("automatically separates year, month and day", () => {
    expect(formatDateOfBirthInput("1990")).toBe("1990");
    expect(formatDateOfBirthInput("19901")).toBe("1990-1");
    expect(formatDateOfBirthInput("199001")).toBe("1990-01");
    expect(formatDateOfBirthInput("19900131")).toBe("1990-01-31");
  });

  it("accepts pasted formatted values and caps at eight digits", () => {
    expect(formatDateOfBirthInput("1990/01/31")).toBe("1990-01-31");
    expect(formatDateOfBirthInput("1990013199")).toBe("1990-01-31");
  });

  it("lets deletion naturally move back across separators", () => {
    expect(formatDateOfBirthInput("1990-01-")).toBe("1990-01");
    expect(formatDateOfBirthInput("1990-0")).toBe("1990-0");
  });
});

describe("AUTH-DOB-AGE-001 registration 18+ gate shared by inline hint and submit", () => {
  const now = new Date("2026-09-10T00:00:00.000Z");

  it("accepts an adult birth date", () => {
    expect(getDateOfBirthError("1990-01-31", now)).toBeUndefined();
    expect(getDateOfBirthError("2008-09-09", now)).toBeUndefined();
  });

  it("rejects an under-18 birth date with the submit-time message", () => {
    expect(getDateOfBirthError("2010-01-01", now)).toBe("需年满 18 岁才能注册。");
    expect(getDateOfBirthError("2008-09-11", now)).toBe("需年满 18 岁才能注册。");
  });

  it("rejects incomplete and non-calendar values", () => {
    expect(getDateOfBirthError("1990-01", now)).toBe("请输入有效的出生日期 (YYYY-MM-DD)。");
    expect(getDateOfBirthError("", now)).toBe("请输入有效的出生日期 (YYYY-MM-DD)。");
  });
});
