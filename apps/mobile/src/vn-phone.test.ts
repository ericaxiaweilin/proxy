import { describe, expect, it } from "vitest";
import { formatVietnamesePhoneForDisplay, normalizeVietnamesePhone, vietnamesePhoneReady } from "./vn-phone";

describe("normalizeVietnamesePhone", () => {
  // Real input habits of Chinese users holding +84 numbers.
  it.each([
    ["0912345678", "+84912345678"],   // national format with trunk 0 (cards / Zalo profiles) — the killer case
    ["(+84)912345678", "+84912345678"], // pasted from contacts app
    ["+84912345678", "+84912345678"],  // pasted E.164
    ["84912345678", "+84912345678"],   // typed country code
    ["84 912 345 678", "+84912345678"],// spaced national with country code
    ["0084912345678", "+84912345678"], // CN international dial prefix habit
    ["00 84 912 345 678", "+84912345678"],
    ["840912345678", "+84912345678"],  // country code + trunk 0 combo
    ["0961234567", "+84961234567"],     // Viettel mobile
    ["0771234567", "+84771234567"],    // Vinaphone mobile
    ["0355123456", "+84355123456"],    // Vietnamobile
    ["02412345678", "+842412345678"],  // Hanoi landline (10 digits, leading 2)
    ["02812345678", "+842812345678"],  // HCMC landline
    ["", ""],
    ["123", ""],                        // garbage
    ["091234567", ""],                  // 8 digits — one short of mobile plan
    ["0123456789", ""],                 // 10 digits leading 1 — not a VN prefix
  ])("%s -> %s", (input, expected) => {
    expect(normalizeVietnamesePhone(input)).toBe(expected);
  });

  it("rejects numbers that become too short after prefix stripping", () => {
    expect(normalizeVietnamesePhone("840")).toBe("");
    expect(normalizeVietnamesePhone("00")).toBe("");
  });
});

describe("vietnamesePhoneReady", () => {
  it("gates the send button on a parseable E.164", () => {
    expect(vietnamesePhoneReady("0912345678")).toBe(true);
    expect(vietnamesePhoneReady("+84912345678")).toBe(true);
    expect(vietnamesePhoneReady("123")).toBe(false);
    expect(vietnamesePhoneReady("")).toBe(false);
  });
});

describe("formatVietnamesePhoneForDisplay", () => {
  it("pretty-prints for the helper line", () => {
    expect(formatVietnamesePhoneForDisplay("+84912345678")).toBe("+84 912345678");
    expect(formatVietnamesePhoneForDisplay("+842412345678")).toBe("+84 2412345678");
    expect(formatVietnamesePhoneForDisplay("other")).toBe("other");
  });
});
