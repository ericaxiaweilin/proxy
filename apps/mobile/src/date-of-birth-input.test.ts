import { describe, expect, it } from "vitest";
import { formatDateOfBirthInput } from "./date-of-birth-input";

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
