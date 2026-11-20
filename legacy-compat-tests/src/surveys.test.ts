// The old survey record actions with an access key (hosted Step 6, ADR 0040): §15-22, §24-30,
// §33-35, §53-55 and the bare prefix (§14).
import { describe } from "vitest";
import { goldenTests } from "./harness.js";

describe("getSurveyInfo", () => goldenTests(["getSurveyInfo"]));
describe("getActive", () => goldenTests(["getActive"]));
describe("getArchive", () => goldenTests(["getArchive"]));
describe("create", () => goldenTests(["create"]));
describe("archive", () => goldenTests(["archive"]));
describe("restore", () => goldenTests(["restore"]));
describe("delete", () => goldenTests(["delete"]));
describe("changeName", () => goldenTests(["changeName"]));
describe("getIsPublished", () => goldenTests(["getIsPublished"]));
describe("publishVersion", () => goldenTests(["publishVersion"]));
describe("publish", () => goldenTests(["publish"]));
describe("unPublish", () => goldenTests(["unPublish"]));
describe("setUseCookies", () => goldenTests(["setUseCookies"]));
describe("changeVersionTitle", () => goldenTests(["changeVersionTitle"]));
describe("getIsResultPublic", () => goldenTests(["getIsResultPublic"]));
describe("makeResultPublic", () => goldenTests(["makeResultPublic"]));
describe("storeIPAddressInResult", () => goldenTests(["storeIPAddressInResult"]));
describe("clone", () => goldenTests(["clone"]));
describe("changeOrganization", () => goldenTests(["changeOrganization"]));
describe("the bare prefix", () => goldenTests(["root"]));
