// Vietnamese phone input normalization for the login screen.
//
// Serves Chinese users living in Vietnam: they hold +84 numbers but type
// them in mixed habits — Vietnamese national format with trunk 0
// ("0912 345 678", how numbers are printed on cards and Zalo profiles),
// pasted E.164 ("+84912345678"), a hand-typed country code ("84912345678"),
// or the CN international dial prefix habit ("0084..."). The backend only
// accepts strict E.164 ("+" then digits), and E.164 has no trunk 0 — so a
// raw "+84" + "0912..." concat silently targets +840912345678 and the OTP
// never arrives. Every input path must collapse to +84 + the national
// significant number before leaving the client.

/** Returns canonical E.164 ("+84912345678") or "" when unparseable. */
export function normalizeVietnamesePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  // Collapse leading prefix habits: CN international dial "00", typed
  // country code "84", Vietnamese trunk "0". Loop covers combinations
  // like 00-84-0-trunk (and the odd "084..."). Stripping is safe: no
  // valid Vietnamese national significant number starts with 0, 84 or 00.
  for (let round = 0; round < 4; round++) {
    if (digits.startsWith("00")) {
      digits = digits.slice(2);
      continue;
    }
    if (digits.startsWith("84")) {
      digits = digits.slice(2);
      continue;
    }
    if (digits.startsWith("0")) {
      digits = digits.slice(1);
      continue;
    }
    break;
  }
  // Vietnamese numbering plan after prefixes are gone:
  //   mobile:   9 digits, leading 3/5/7/8/9  (096/035/077/088/091 → 96/35/77/88/91)
  //   landline: 10 digits, leading 2        (024/028 Hanoi/HCMC → 24/28)
  const first = digits.charAt(0);
  const isMobile = digits.length === 9 && "35789".includes(first);
  const isLandline = digits.length === 10 && first === "2";
  if (!isMobile && !isLandline) return "";
  return `+84${digits}`;
}

/** Button-enable gate for the SMS channel. */
export function vietnamesePhoneReady(raw: string): boolean {
  return normalizeVietnamesePhone(raw) !== "";
}

/** "+84912345678" → "+84 912345678" for the "验证码已发送至" helper line. */
export function formatVietnamesePhoneForDisplay(e164: string): string {
  if (!e164.startsWith("+84")) return e164;
  return `+84 ${e164.slice(3)}`;
}
