/** Small parser for ADO-style `key=value;key=value` connection strings (SQL Server and Azure Storage). */
export function parseConnectionString(value: string): Map<string, string> {
  const pairs = new Map<string, string>();
  for (const part of value.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    pairs.set(part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim());
  }
  return pairs;
}
