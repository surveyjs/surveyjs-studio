import { isIP, isIPv4, isIPv6 } from "node:net";

const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** The address to store for a respondent: an IPv4-mapped IPv6 address becomes plain IPv4. */
export function respondentIp(ip: string): string {
  const mapped = MAPPED_IPV4.exec(ip)?.[1];
  return mapped !== undefined && isIPv4(mapped) ? mapped : ip;
}

/** The eight 16-bit groups of an IPv6 address (no zone), or null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  if (!isIPv6(address)) return null;
  let text = address;
  const dot = text.lastIndexOf(".");
  if (dot >= 0) {
    const colon = text.lastIndexOf(":");
    const octets = text
      .slice(colon + 1)
      .split(".")
      .map(Number);
    const high = (octets[0]! << 8) | octets[1]!;
    const low = (octets[2]! << 8) | octets[3]!;
    text = `${text.slice(0, colon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const toGroups = (part: string) =>
    part === "" ? [] : part.split(":").map((g) => parseInt(g, 16));
  const first = toGroups(head);
  if (tail === undefined) return first;
  const last = toGroups(tail);
  return [...first, ...Array<number>(8 - first.length - last.length).fill(0), ...last];
}

/**
 * The client address as it may appear in logs: IPv4 with the last octet zeroed, IPv6 reduced to its
 * first three groups followed by `::`. Anything else is `unknown`.
 */
export function truncatedIp(ip: string): string {
  const plain = respondentIp(ip.split("%")[0] ?? "");
  if (isIP(plain) === 4) return `${plain.split(".").slice(0, 3).join(".")}.0`;
  const groups = ipv6Groups(plain);
  if (groups === null) return "unknown";
  return `${groups
    .slice(0, 3)
    .map((g) => g.toString(16))
    .join(":")}::`;
}
