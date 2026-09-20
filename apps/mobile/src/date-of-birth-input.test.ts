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

// AUTH-DOB-BOUNDS-001 (2026-09-20, P0): 报障原文 —— 注册页输入 `1999-99-99`
// 判通过并发了验证码。根因不是「没校验」，而是**把合法性交给了 `new Date(value)`**：
// 越界 ISO 串在不同 JS 引擎上结果不同（实测 Node/V8 把 1999-99-99 判成 Invalid
// Date，而真机 Hermes 会滚月成合法日期），所以同一个输入一个引擎拦、一个引擎放。
// 修法：月份/日期边界自己判，再用 UTC 回读确认这一天真实存在。
describe("AUTH-DOB-BOUNDS-001 out-of-range month/day must not slip through the age gate", () => {
  const now = new Date("2026-09-10T00:00:00.000Z");

  it("rejects a month above 12 or below 1", () => {
    expect(getDateOfBirthError("1999-99-99", now)).toBe("月份需要在 1-12 之间。");
    expect(getDateOfBirthError("1999-13-01", now)).toBe("月份需要在 1-12 之间。");
    expect(getDateOfBirthError("1999-00-10", now)).toBe("月份需要在 1-12 之间。");
  });

  it("rejects a day above 31 or below 1", () => {
    expect(getDateOfBirthError("1999-01-32", now)).toBe("日期需要在 1-31 之间。");
    expect(getDateOfBirthError("1999-01-00", now)).toBe("日期需要在 1-31 之间。");
  });

  it("rejects a day that does not exist in that month, instead of silently rolling over", () => {
    // 这三条才是真正的洞：日不越 31，但 Date 会把它们滚到下个月 ——
    // 1999-02-31 → 1999-03-03，1999-04-31 → 1999-05-01，2000-02-30 → 2000-03-01。
    expect(getDateOfBirthError("1999-02-31", now)).toBe("出生日期不是合法日期。");
    expect(getDateOfBirthError("1999-04-31", now)).toBe("出生日期不是合法日期。");
    expect(getDateOfBirthError("2000-02-30", now)).toBe("出生日期不是合法日期。");
  });

  it("still accepts real dates, including a real leap day", () => {
    expect(getDateOfBirthError("1999-02-28", now)).toBeUndefined();
    expect(getDateOfBirthError("2000-02-29", now)).toBeUndefined();
    expect(getDateOfBirthError("1999-04-30", now)).toBeUndefined();
    expect(getDateOfBirthError("1999-12-31", now)).toBeUndefined();
    // 1999 不是闰年 → 02-29 不存在，必须拒（别把闰年判反）。
    expect(getDateOfBirthError("1999-02-29", now)).toBe("出生日期不是合法日期。");
  });

  it("reports the boundary error before the age error, so a bogus month can never read as an adult", () => {
    expect(getDateOfBirthError("2020-99-99", now)).toBe("月份需要在 1-12 之间。");
  });
});
