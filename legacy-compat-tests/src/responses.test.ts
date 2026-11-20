// The old response actions with an access key (hosted Step 6, ADR 0040): deleteResult (§36),
// deleteAllResults (§37), getSurveyResults (§48), getSurveyDemoResults (§49) and
// exportSurveyResults (§50).
import { describe } from "vitest";
import { goldenTests } from "./harness.js";

describe("deleteResult", () => goldenTests(["deleteResult"]));
describe("deleteAllResults", () => goldenTests(["deleteAllResults"]));
describe("getSurveyResults", () => goldenTests(["getSurveyResults"]));
describe("getSurveyDemoResults", () => goldenTests(["getSurveyDemoResults"]));
describe("exportSurveyResults", () => goldenTests(["exportSurveyResults"]));
