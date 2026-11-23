import { describe, expect, it } from "vitest";
import { readSample, SampleError } from "./sample.js";

describe("readSample", () => {
  it("reads the columns in any order, with quoted commas, quotes and CRLF line ends", () => {
    const csv =
      "status,query,path,method,time\r\n" +
      '200,"a=1,2&b=""x""",/public/Survey/getSurvey,GET,2026-11-20T10:00:00Z\r\n' +
      '404,,"/a,b",get,2026-11-20T10:00:01Z\r\n';
    expect(readSample(csv)).toEqual([
      {
        time: "2026-11-20T10:00:00Z",
        method: "GET",
        path: "/public/Survey/getSurvey",
        query: 'a=1,2&b="x"',
        status: 200,
      },
      { time: "2026-11-20T10:00:01Z", method: "get", path: "/a,b", query: "", status: 404 },
    ]);
  });

  it("reads a quoted field over two lines, a byte order mark and no final line end", () => {
    const csv = '\uFEFFtime,method,path,query,status\nt,GET,"/x\ny",q,200';
    expect(readSample(csv)).toEqual([
      { time: "t", method: "GET", path: "/x\ny", query: "q", status: 200 },
    ]);
  });

  it("names a missing column", () => {
    expect(() => readSample("time,method,path,status\nt,GET,/x,200\n")).toThrow(
      new SampleError('the sample has no "query" column'),
    );
  });

  it("names a column it does not know", () => {
    expect(() => readSample("time,method,path,query,status,extra\n")).toThrow(
      new SampleError('the sample has a column "extra" (want time,method,path,query,status)'),
    );
  });

  it("refuses a column given twice", () => {
    expect(() => readSample("time,method,path,query,status,time\n")).toThrow(
      new SampleError('the sample has two "time" columns'),
    );
  });

  it("refuses a row with another number of fields, by line, without its content", () => {
    expect(() => readSample("time,method,path,query,status\nt,GET,/x,secret\n")).toThrow(
      new SampleError("line 2 has 4 fields, the header 5"),
    );
  });

  it("refuses a status that is not a number", () => {
    expect(() => readSample("time,method,path,query,status\nt,GET,/x,,ok\n")).toThrow(
      new SampleError("line 2: status is not a number"),
    );
  });

  it("refuses an unterminated quote", () => {
    expect(() => readSample('time,method,path,query,status\nt,GET,"/x,,200\n')).toThrow(
      new SampleError("the sample ends inside a quoted field"),
    );
  });
});
