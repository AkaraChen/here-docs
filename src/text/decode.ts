import { analyse } from "chardet";
import iconv from "iconv-lite";
import { cjkPlausibility } from "./cjk-frequency.js";

export interface DecodedText {
  text: string;
  /** The encoding the bytes were decoded with, as an iconv-lite name. */
  encoding: string;
}

/** Detection reads at most this many bytes, so sniffing cost does not grow with the input. */
export const SNIFF_BYTES = 64 * 1024;

/**
 * Decodes text bytes: a BOM wins, then strict UTF-8, then a declared charset, then statistical detection.
 * Valid UTF-8 beats a declared legacy charset: pages and mails that declare GBK or Latin-1 but carry UTF-8
 * are a common misconfiguration, while legacy text that happens to be valid UTF-8 is rare.
 * Returns null when the bytes do not look like text.
 */
export function decodeText(bytes: Uint8Array, declared?: string): DecodedText | null {
  const bom = bomEncoding(bytes) ?? utf16WithoutBom(bytes);
  if (bom) {
    return { text: stripBom(iconv.decode(toBuffer(bytes), bom.encoding)), encoding: bom.encoding };
  }
  if (!looksLikeText(bytes)) {
    return null;
  }
  if (isIso2022Jp(bytes)) {
    return { text: decodeWith(bytes, "iso-2022-jp"), encoding: "iso-2022-jp" };
  }
  const utf8 = strictUtf8(bytes, false);
  if (utf8 !== null) {
    return { text: utf8, encoding: "utf-8" };
  }
  const label = declared ? normalizeLabel(declared) : null;
  if (label && label !== "utf-8" && canDecode(label)) {
    return { text: decodeWith(bytes, label), encoding: label };
  }
  const detected = detectEncoding(bytes);
  return { text: decodeWith(bytes, detected), encoding: detected };
}

/** Like `decodeText`, but decodes anything: binary-looking bytes fall back to UTF-8 with replacement. */
export function decodeTextLoose(bytes: Uint8Array, declared?: string): string {
  return decodeText(bytes, declared)?.text ?? new TextDecoder().decode(bytes);
}

/** Decodes only a prefix, for format sniffing. Returns null when the prefix does not look like text. */
export function sniffText(bytes: Uint8Array): string | null {
  const head = bytes.subarray(0, SNIFF_BYTES);
  const bom = bomEncoding(head) ?? utf16WithoutBom(head);
  if (bom) {
    return stripBom(iconv.decode(toBuffer(head), bom.encoding));
  }
  if (!looksLikeText(head)) {
    return null;
  }
  if (isIso2022Jp(head)) {
    return decodeWith(head, "iso-2022-jp");
  }
  // A cut multi-byte sequence at the end of the prefix is not an encoding error.
  const utf8 = strictUtf8(head, head.length < bytes.length);
  if (utf8 !== null) {
    return utf8;
  }
  return iconv.decode(toBuffer(head), detectEncoding(head));
}

/** UTF-8 bytes for text in any detectable encoding; UTF-8 input (minus a BOM) is returned as is. */
export function toUtf8(bytes: Uint8Array): Uint8Array {
  const bom = bomEncoding(bytes) ?? utf16WithoutBom(bytes);
  if (bom?.encoding === "utf-8") {
    return bytes.subarray(bom.length);
  }
  if (!bom && strictUtf8(bytes, false) !== null) {
    return bytes;
  }
  const decoded = decodeText(bytes);
  return decoded ? new TextEncoder().encode(decoded.text) : bytes;
}

/** Text has no NUL bytes and almost no other C0 control characters (tab, newlines, form feed, and escape excepted). */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }
  let controls = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      return false;
    }
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c && byte !== 0x1b && byte !== 0x0b) {
      controls += 1;
    }
  }
  return controls / bytes.length < 0.01;
}

function bomEncoding(bytes: Uint8Array): { encoding: string; length: number } | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: "utf-8", length: 3 };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: "utf-16le", length: 2 };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { encoding: "utf-16be", length: 2 };
  }
  return null;
}

/** The share of bytes ≥ 0x80 that sit next to another such byte. */
function pairedHighBytes(bytes: Uint8Array): number {
  let high = 0;
  let paired = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i]! >= 0x80) {
      high += 1;
      if ((bytes[i - 1] ?? 0) >= 0x80 || (bytes[i + 1] ?? 0) >= 0x80) {
        paired += 1;
      }
    }
  }
  return high === 0 ? 0 : paired / high;
}

/** The legacy encoding statistical detection picks for `bytes` (which are not UTF-8). */
export function detectLegacyEncoding(bytes: Uint8Array): string {
  return detectEncoding(bytes);
}

/**
 * UTF-16 without a BOM: ASCII characters put NUL bytes on one side of each code unit. The guess is kept
 * only if the decoded text is free of control characters.
 */
function utf16WithoutBom(bytes: Uint8Array): { encoding: string; length: number } | null {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096) & ~1);
  if (sample.length < 4) {
    return null;
  }
  let even = 0;
  let odd = 0;
  for (let i = 0; i < sample.length; i += 2) {
    if (sample[i] === 0) even += 1;
    if (sample[i + 1] === 0) odd += 1;
  }
  const units = sample.length / 2;
  // CJK code units such as U+3000 put a NUL on the other side too, so the split only has to be lopsided.
  const encoding = odd > units * 0.05 && even * 10 < odd ? "utf-16le" : even > units * 0.05 && odd * 10 < even ? "utf-16be" : null;
  if (!encoding) {
    return null;
  }
  const text = iconv.decode(toBuffer(sample), encoding);
  return /[\u0000-\u0008\u000e-\u001f\ufffd]/.test(text) ? null : { encoding, length: 0 };
}

/** ISO-2022-JP is 7-bit: kanji and kana hide behind `ESC $ B` / `ESC $ @` shifts, so it also passes as UTF-8. */
function isIso2022Jp(bytes: Uint8Array): boolean {
  const head = toBuffer(bytes.subarray(0, SNIFF_BYTES));
  return (head.includes("\u001b$B", 0, "latin1") || head.includes("\u001b$@", 0, "latin1")) && head.every((byte) => byte < 0x80);
}

/** iconv-lite covers most encodings; the runtime's decoder fills the gaps (ISO-2022-JP). */
function canDecode(label: string): boolean {
  if (iconv.encodingExists(label)) {
    return true;
  }
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

function decodeWith(bytes: Uint8Array, label: string): string {
  if (iconv.encodingExists(label)) {
    return iconv.decode(toBuffer(bytes), label);
  }
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function strictUtf8(bytes: Uint8Array, truncated: boolean): string | null {
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated }));
  } catch {
    return null;
  }
}

const CJK_ENCODINGS = ["gb18030", "big5hkscs", "cp932", "euc-jp", "cp949"];

function detectEncoding(bytes: Uint8Array): string {
  const matches = analyse(bytes)
    .map((match) => ({ label: normalizeLabel(match.name), confidence: match.confidence }))
    .filter((match): match is { label: string; confidence: number } => match.label !== null && iconv.encodingExists(match.label));
  const top = matches[0];
  if (!top) {
    return "windows-1252";
  }
  const topIsCjk = CJK_ENCODINGS.includes(top.label);
  if (top.confidence >= (topIsCjk ? 50 : 90)) {
    return top.label;
  }
  // Short inputs are ambiguous: CJK encodings tie, and single-byte guesses win on a few bytes. A multi-byte
  // decoding made of common characters beats such a guess; GB18030 goes first so that it wins an exact tie.
  const buffer = toBuffer(bytes);
  let best = top.label;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const label of CJK_ENCODINGS) {
    const score = cjkPlausibility(iconv.decode(buffer, label));
    if (score > bestScore) {
      best = label;
      bestScore = score;
    }
  }
  // Double-byte encodings keep high bytes in pairs; Latin-1 accents stand alone (`Libellé_`), where a lone
  // high byte plus the next ASCII byte can still spell a common CJK character.
  if ((bestScore >= 0.6 || (topIsCjk && bestScore >= 0.3)) && pairedHighBytes(bytes) >= 0.6) {
    return best;
  }
  return matches.find((match) => !CJK_ENCODINGS.includes(match.label))?.label ?? best;
}

function normalizeLabel(label: string): string | null {
  const name = label.trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (!name) {
    return null;
  }
  // As in the WHATWG Encoding Standard, legacy labels decode with the superset that producers actually
  // write: GB18030 for GB2312/GBK, Windows-31J for Shift_JIS, UHC for EUC-KR, Big5-HKSCS for Big5.
  if (name === "gb2312" || name === "gbk" || name === "x-gbk" || name === "cp936") {
    return "gb18030";
  }
  if (name === "shift_jis" || name === "shift-jis" || name === "sjis" || name === "x-sjis" || name === "ms_kanji" || name === "windows-31j") {
    return "cp932";
  }
  if (name === "euc-kr" || name === "ks_c_5601-1987" || name === "windows-949" || name === "uhc") {
    return "cp949";
  }
  if (name === "big5" || name === "big5-hkscs" || name === "x-x-big5" || name === "cp950") {
    return "big5hkscs";
  }
  if (name === "utf8") {
    return "utf-8";
  }
  return name;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
