/** An allowed type of a stored file (R6) and whether browsers show it in place. */
export interface AllowedFileType {
  readonly contentType: string;
  /** Served `inline` (images); otherwise as `attachment`. */
  readonly inline: boolean;
}

/** The `415` detail: what may be uploaded. */
export const ALLOWED_TYPES_TEXT =
  "Upload a PNG, JPEG, GIF, WebP, AVIF, BMP or SVG image, or an MP4, WebM or Ogg video.";

const image = (contentType: string): AllowedFileType => ({ contentType, inline: true });
const video = (contentType: string): AllowedFileType => ({ contentType, inline: false });

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EBML_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];
const BMP_INFO_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);
const AVIF_BRANDS = new Set(["avif", "avis"]);
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "mp41",
  "mp42",
  "avc1",
  "M4V ",
  "dash",
  "mmp4",
]);
/** How much of the file the SVG check reads. */
const SVG_PREFIX_BYTES = 4096;

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

/** The bytes at `offset` read as Latin-1 text (one character per byte). */
function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function isBmp(bytes: Uint8Array): boolean {
  if (ascii(bytes, 0, 2) !== "BM" || bytes.length < 18) return false;
  const headerSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    14,
    true,
  );
  return BMP_INFO_HEADER_SIZES.has(headerSize);
}

/** The text before the root element of an SVG: whitespace, an XML declaration, comments, a doctype. */
function skipProlog(text: string): string {
  let rest = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let declarationSeen = false;
  for (;;) {
    rest = rest.trimStart();
    if (!declarationSeen && /^<\?xml[\s?]/.test(rest)) {
      const end = rest.indexOf("?>");
      if (end < 0) return "";
      rest = rest.slice(end + 2);
      declarationSeen = true;
    } else if (rest.startsWith("<!--")) {
      const end = rest.indexOf("-->", 4);
      if (end < 0) return "";
      rest = rest.slice(end + 3);
    } else if (rest.startsWith("<!DOCTYPE")) {
      const end = rest.indexOf(">");
      // An internal subset (`[ … ]`) may declare entities: not accepted.
      if (end < 0 || rest.slice(0, end).includes("[")) return "";
      rest = rest.slice(end + 1);
    } else {
      return rest;
    }
  }
}

function isSvg(bytes: Uint8Array): boolean {
  const text = new TextDecoder("utf-8").decode(bytes.subarray(0, SVG_PREFIX_BYTES));
  return /^<svg[\s>/]/.test(skipProlog(text));
}

/** The allowed type of a file, decided from its bytes only (R6); null when it is not allowed. */
export function detectFileType(bytes: Uint8Array): AllowedFileType | null {
  if (hasBytes(bytes, 0, PNG_SIGNATURE)) return image("image/png");
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return image("image/jpeg");
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") return image("image/gif");
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return image("image/webp");
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (AVIF_BRANDS.has(brand)) return image("image/avif");
    if (MP4_BRANDS.has(brand)) return video("video/mp4");
  }
  if (isBmp(bytes)) return image("image/bmp");
  if (
    hasBytes(bytes, 0, EBML_SIGNATURE) &&
    ascii(bytes, 0, Math.min(64, bytes.length)).includes("webm")
  ) {
    return video("video/webm");
  }
  if (ascii(bytes, 0, 4) === "OggS") return video("video/ogg");
  if (isSvg(bytes)) return image("image/svg+xml");
  return null;
}

/** RFC 5987 encoding: `encodeURIComponent` plus the characters it leaves that RFC 5987 does not allow. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `Content-Disposition` of a download: `inline` for images, else `attachment`, with both file names. */
export function contentDisposition(file: { contentType: string; name: string }): string {
  const kind = file.contentType.startsWith("image/") ? "inline" : "attachment";
  const ascii = file.name.replace(/[^\x20-\x7e]|["\\%]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(file.name)}`;
}

const MAX_NAME_LENGTH = 255;

/** The stored name of an uploaded file (R12): no folder part, no control characters, 1–255 code units. */
export function fileNameOf(raw: string | undefined): string {
  const base = (raw ?? "").split(/[/\\]/).pop() ?? "";
  const printable = [...base].filter((char) => char >= " " && char !== "\u007f").join("");
  const name = printable.trim().slice(0, MAX_NAME_LENGTH);
  return name === "" ? "file" : name;
}
