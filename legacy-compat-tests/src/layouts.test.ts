// The old results layout actions (hosted Step 6, ADR 0040 point 4): §38-47 with an access key,
// and the three reads without one (§58).
import { describe } from "vitest";
import { goldenTests } from "./harness.js";

describe("getResultColumns", () => goldenTests(["getResultColumns"]));
describe("setResultColumns", () => goldenTests(["setResultColumns"]));
describe("getResultTableState", () => goldenTests(["getResultTableState"]));
describe("setResultTableState", () => goldenTests(["setResultTableState"]));
describe("getResultSummaryState", () => goldenTests(["getResultSummaryState"]));
describe("setResultSummaryState", () => goldenTests(["setResultSummaryState"]));
describe("setResultPermissions", () => goldenTests(["setResultPermissions"]));
describe("getResultPublicColumns", () => goldenTests(["getResultPublicColumns"]));
describe("getPublicResultTableState", () => goldenTests(["getPublicResultTableState"]));
describe("getPublicResultSummaryState", () => goldenTests(["getPublicResultSummaryState"]));
