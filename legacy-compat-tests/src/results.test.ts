// The old results reads: getResult (§5) and getSurveyPublicResults (§10).
import { describe } from "vitest";
import { goldenTests } from "./harness.js";

describe("getResult", () => goldenTests(["getResult"]));
describe("getSurveyPublicResults", () => goldenTests(["getSurveyPublicResults"]));
