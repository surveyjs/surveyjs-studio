// The old survey reads: getSurvey (§1), getSurveyAndIsCompleted (§2), isCompleted (§6), and the
// CORS answers every action gives.
import { describe } from "vitest";
import { goldenTests } from "./harness.js";

describe("getSurvey", () => goldenTests(["getSurvey"]));
describe("getSurveyAndIsCompleted", () => goldenTests(["getSurveyAndIsCompleted"]));
describe("isCompleted", () => goldenTests(["isCompleted"]));
describe("CORS", () => goldenTests(["cors"]));
