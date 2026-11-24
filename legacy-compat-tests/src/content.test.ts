// The old content actions with an access key (hosted Step 6, ADR 0040): changeJson (§23),
// changeTheme (§51), getHistoryPoint (§28) and uploadFiles (§52).
import { describe } from "vitest";
import { goldenTests } from "./harness.js";

describe("changeJson", () => goldenTests(["changeJson"]));
describe("changeTheme", () => goldenTests(["changeTheme"]));
describe("getHistoryPoint", () => goldenTests(["getHistoryPoint"]));
describe("uploadFiles", () => goldenTests(["uploadFiles"]));
