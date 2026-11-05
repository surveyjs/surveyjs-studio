// A small multipart/form-data reader for the upload handlers. `request.formData()` fails under
// jsdom (whose `File` replaces Node's) and the sandbox must answer the same in a browser's service
// worker and under msw/node, so the body is read as bytes and split here. Mirrors what the server
// takes from a multipart body (server/src/files/handlers.ts `readFirstFile`): the first file part.
import { bodyRequired } from "./common";
import { badRequest, ProblemError } from "./problems";

export interface FilePart {
  /** The form field the file came in. */
  readonly fieldName: string;
  /** The `filename` of the part, as sent. */
  readonly fileName: string | undefined;
  readonly bytes: Uint8Array;
}

const unreadable = () => badRequest("The multipart body could not be read.");

/**
 * The checks the server makes on an upload's body before its handler runs (server/src/api.ts
 * `bodyGuard`, after authentication and before the path is validated): no body at all is
 * `422 validation-failed`, a body in any other media type than multipart/form-data is `415`.
 */
export function checkMultipart(request: Request): void {
  const mediaType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (mediaType === "multipart/form-data") return;
  if (mediaType === undefined && request.body === null) throw bodyRequired();
  throw new ProblemError({
    code: "unsupported-media-type",
    status: 415,
    title: "Unsupported media type",
    detail: "Send the body as multipart/form-data.",
  });
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8");

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const first = needle[0]!;
  for (let at = haystack.indexOf(first, from); at >= 0; at = haystack.indexOf(first, at + 1)) {
    if (at + needle.length > haystack.length) return -1;
    let same = true;
    for (let i = 1; i < needle.length && same; i++) same = haystack[at + i] === needle[i];
    if (same) return at;
  }
  return -1;
}

/**
 * The first part with a file name, or undefined when there is none. A request that is no
 * multipart body, or whose body is cut or malformed, is `400 bad-request`.
 */
export async function readFirstFile(request: Request): Promise<FilePart | undefined> {
  const contentType = request.headers.get("content-type") ?? "";
  const boundary = /^multipart\/form-data\s*;.*\bboundary=(?:"([^"]+)"|([^;\s]+))/i.exec(
    contentType,
  );
  const token = boundary?.[1] ?? boundary?.[2];
  if (token === undefined) throw unreadable();
  const body = new Uint8Array(await request.arrayBuffer());
  const delimiter = encoder.encode(`--${token}`);
  const separator = encoder.encode(`\r\n--${token}`);
  const headEnd = encoder.encode("\r\n\r\n");

  let at = indexOfBytes(body, delimiter, 0);
  if (at < 0) throw unreadable();
  for (;;) {
    at += delimiter.length;
    // "--" after a delimiter closes the body; CRLF starts the next part.
    if (body[at] === 0x2d && body[at + 1] === 0x2d) return undefined;
    if (body[at] !== 0x0d || body[at + 1] !== 0x0a) throw unreadable();
    const start = at + 2;
    const split = indexOfBytes(body, headEnd, start);
    if (split < 0) throw unreadable();
    const end = indexOfBytes(body, separator, split + headEnd.length);
    if (end < 0) throw unreadable();
    const head = decoder.decode(body.subarray(start, split));
    const fileName = /;\s*filename="([^"]*)"/i.exec(head)?.[1];
    if (fileName !== undefined) {
      const fieldName = /;\s*name="([^"]*)"/i.exec(head)?.[1] ?? "";
      return { fieldName, fileName, bytes: body.slice(split + headEnd.length, end) };
    }
    at = end + 2; // at the delimiter that follows
  }
}
