import { describe, expect, it, vi } from "vitest";

// The SQL driver, faked: the first connect fails, later ones succeed with an empty table.
const connect = vi.fn();
vi.mock("mssql", () => {
  class ConnectionPool {
    on() {
      return this;
    }
    connect = connect;
    close() {
      return Promise.resolve();
    }
  }
  return { default: { ConnectionPool, DateTime: "DateTime", Int: "Int", UniqueIdentifier: "Uid" } };
});

const { openSqlSource } = await import("./sql.js");
const { openShareSource } = await import("./shares.js");

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const item of items) found.push(item);
  return found;
}

describe("the SQL reader's connection", () => {
  it("tries again after a failed connect", async () => {
    const request = () => ({
      input() {
        return this;
      },
      query: () => Promise.resolve({ recordset: [] }),
    });
    connect
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({ request } as never);
    const source = openSqlSource("Server=127.0.0.1;Database=x;User Id=a;Password=b");
    await expect(collect(source.users())).rejects.toThrow();
    expect(await collect(source.users())).toEqual([]);
    expect(connect).toHaveBeenCalledTimes(2);
    await source.close();
  });
});

describe("a source opened without shares", () => {
  it("lists no share files, even with a remote storage account", async () => {
    const remote =
      "DefaultEndpointsProtocol=https;AccountName=nobody;AccountKey=bm9ib2R5;" +
      "FileEndpoint=https://nobody.invalid";
    const shares = openShareSource(
      { surveysStorageConnectionString: remote, resultsStorageConnectionString: remote },
      null,
    );
    expect(await collect(shares.shareFiles("files"))).toEqual([]);
    expect(await collect(shares.shareFiles("surveyfiles"))).toEqual([]);
    expect(await shares.shareFile("files", "x.png")).toBeNull();
  });
});
