/** Small parser for ADO-style `key=value;key=value` connection strings (SQL Server and Azure Storage). */
export function parseConnectionString(value: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const [key, item] of connectionStringEntries(value)) pairs.set(key, item);
  return pairs;
}

/**
 * Every `key=value` part in order, keys lower-cased, duplicates kept. Splits on every `;` and does
 * not honour quotes, so a quoted value that hides `key=value` text shows up as an extra entry.
 * Safety checks use this to see every value a driver might pick.
 */
export function connectionStringEntries(value: string): [key: string, value: string][] {
  const entries: [string, string][] = [];
  for (const part of value.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    entries.push([part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()]);
  }
  return entries;
}
