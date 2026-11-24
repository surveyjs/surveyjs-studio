// The old file reads: image (§7), file (§8) and files?name= (§9).
import { describe } from "vitest";
import { goldenTests } from "./harness.js";

describe("image", () => goldenTests(["image"]));
describe("file", () => goldenTests(["file"]));
describe("files?name=", () => goldenTests(["files"]));
