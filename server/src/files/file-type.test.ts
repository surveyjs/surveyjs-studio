import { describe, expect, it } from "vitest";
import { contentDisposition, detectFileType, fileNameOf } from "./file-type.js";

/** Bytes from numbers and Latin-1 strings, in order. */
function bytes(...parts: (number | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") out.push(part);
    else for (const char of part) out.push(char.charCodeAt(0));
  }
  return new Uint8Array(out);
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const PNG = bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a);
/** A BMP file header (14 bytes) followed by the info header size, little-endian. */
const bmp = (headerSize: number) =>
  bytes("BM", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, headerSize, 0, 0, 0);
const ftyp = (brand: string) => bytes(0, 0, 0, 0x20, "ftyp", brand, 0, 0, 0, 0);
const ebml = (docType: string) => bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, docType);

describe("detectFileType", () => {
  it.each([
    ["PNG", PNG, "image/png", true],
    ["JPEG", bytes(0xff, 0xd8, 0xff), "image/jpeg", true],
    ["GIF87a", bytes("GIF87a"), "image/gif", true],
    ["GIF89a", bytes("GIF89a"), "image/gif", true],
    ["WebP", bytes("RIFF", 0, 0, 0, 0, "WEBP"), "image/webp", true],
    ["AVIF", ftyp("avif"), "image/avif", true],
    ["AVIF sequence", ftyp("avis"), "image/avif", true],
    ["BMP (40)", bmp(40), "image/bmp", true],
    ["BMP (124)", bmp(124), "image/bmp", true],
    ["MP4 (isom)", ftyp("isom"), "video/mp4", false],
    ["MP4 (M4V )", ftyp("M4V "), "video/mp4", false],
    ["MP4 (mp42)", ftyp("mp42"), "video/mp4", false],
    ["WebM", ebml("webm"), "video/webm", false],
    ["Ogg", bytes("OggS", 0), "video/ogg", false],
    // R6 order: BMP is checked before MP4.
    [
      "BMP whose bytes 4–11 read ftypisom",
      bytes("BM", 0, 0, "ftypisom", 0, 0, 40, 0, 0, 0),
      "image/bmp",
      true,
    ],
  ] as const)("%s", (_name, input, contentType, inline) => {
    expect(detectFileType(input)).toStrictEqual({ contentType, inline });
  });

  it.each([
    ["a PNG signature with one byte changed", bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0b)],
    ["RIFF WAVE", bytes("RIFF", 0, 0, 0, 0, "WAVE")],
    ["ftyp heic", ftyp("heic")],
    ["ftyp qt", ftyp("qt  ")],
    ["ftyp M4A", ftyp("M4A ")],
    ["EBML matroska", ebml("matroska")],
    ["BM with a wrong header size", bmp(41)],
    ["a short BM", bytes("BM", 0, 0)],
    ["HTML", utf8("<!doctype html><html><body>hi</body></html>")],
    ["plain text", utf8("hello")],
    ["MZ", bytes("MZ", 0x90, 0)],
    ["nothing", new Uint8Array()],
  ])("%s → null", (_name, input) => {
    expect(detectFileType(input)).toBeNull();
  });

  describe("SVG", () => {
    const svg = { contentType: "image/svg+xml", inline: true };

    it.each([
      ["plain", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
      ["with a BOM", '\ufeff<svg xmlns="http://www.w3.org/2000/svg"/>'],
      ["right after <svg>", "<svg>"],
      ["self-closing", "<svg/>"],
      ["with an XML declaration", '<?xml version="1.0" encoding="UTF-8"?>\n<svg width="1"/>'],
      ["with comments", "<!-- a --> \n<!-- b --><svg\nwidth='1'/>"],
      [
        "with a doctype",
        '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg/>',
      ],
    ])("%s", (_name, text) => {
      expect(detectFileType(utf8(text))).toStrictEqual(svg);
    });

    it.each([
      ["a doctype with an internal subset", '<!DOCTYPE svg [ <!ENTITY x "y"> ]><svg/>'],
      ["HTML", "<html><svg/></html>"],
      ["<svgfoo", "<svgfoo/>"],
      ["an unclosed comment", "<!-- <svg/>"],
      ["two XML declarations", '<?xml version="1.0"?><?xml version="1.0"?><svg/>'],
    ])("%s → null", (_name, text) => {
      expect(detectFileType(utf8(text))).toBeNull();
    });
  });
});

describe("contentDisposition", () => {
  it("is inline for images and attachment for other files", () => {
    expect(contentDisposition({ contentType: "image/png", name: "a.png" })).toBe(
      `inline; filename="a.png"; filename*=UTF-8''a.png`,
    );
    expect(contentDisposition({ contentType: "video/webm", name: "a.webm" })).toBe(
      `attachment; filename="a.webm"; filename*=UTF-8''a.webm`,
    );
  });

  it("gives an ASCII fallback and the RFC 5987 name", () => {
    expect(contentDisposition({ contentType: "image/png", name: 'Логотип "ü" (1).png' })).toBe(
      `inline; filename="_______ ___ (1).png"; ` +
        `filename*=UTF-8''%D0%9B%D0%BE%D0%B3%D0%BE%D1%82%D0%B8%D0%BF%20%22%C3%BC%22%20%281%29.png`,
    );
  });

  it("encodes a name cut at a surrogate pair", () => {
    const a254 = "a".repeat(254);
    const a253 = "a".repeat(253);
    expect(
      contentDisposition({ contentType: "image/png", name: fileNameOf(`${a254}\u{1f600}.png`) }),
    ).toBe(`inline; filename="${a254}"; filename*=UTF-8''${a254}`);
    expect(
      contentDisposition({ contentType: "image/png", name: fileNameOf(`${a253}\u{1f600}.png`) }),
    ).toBe(`inline; filename="${a253}__"; filename*=UTF-8''${a253}%F0%9F%98%80`);
  });

  it("replaces backslashes and percent signs in the fallback", () => {
    expect(contentDisposition({ contentType: "image/png", name: "a\\b%c'*.png" })).toBe(
      `inline; filename="a_b_c'*.png"; filename*=UTF-8''a%5Cb%25c%27%2A.png`,
    );
  });
});

describe("fileNameOf", () => {
  it.each([
    ["photo.png", "photo.png"],
    ["C:\\Users\\me\\photo.png", "photo.png"],
    ["/home/me/photo.png", "photo.png"],
    ["a/b\\c.png", "c.png"],
    ["  spaced.png  ", "spaced.png"],
    ["bad\u0000na\u001fme\u007f.png", "badname.png"],
    ["Логотип.png", "Логотип.png"],
    ["", "file"],
    ["   ", "file"],
    ["folder/", "file"],
    [undefined, "file"],
  ])("%j → %j", (raw, expected) => {
    expect(fileNameOf(raw)).toBe(expected);
  });

  it("cuts the name at 255 UTF-16 code units", () => {
    expect(fileNameOf(`${"a".repeat(300)}.png`)).toBe("a".repeat(255));
  });

  it("leaves out a surrogate pair that would end past the cut", () => {
    // The pair would take code units 255 and 256.
    expect(fileNameOf(`${"a".repeat(254)}\u{1f600}.png`)).toBe("a".repeat(254));
    expect(fileNameOf(`${"a".repeat(253)}\u{1f600}.png`)).toBe(`${"a".repeat(253)}\u{1f600}`);
  });

  it("trims a space the cut ends in", () => {
    expect(fileNameOf(`${"a".repeat(254)} b.png`)).toBe("a".repeat(254));
  });

  it("replaces a lone surrogate", () => {
    expect(fileNameOf("a\ud800b.png")).toBe("a�b.png");
  });
});
