import { describeLicenceNoticeSuite } from "../../providers/suite/licence-notice-suite.js";
import { describeUserDirectorySuite } from "../../providers/suite/user-directory-suite.js";
import { createSurveyjsApiDirectory } from "./client.js";
import { startUserApiStub, stubDataFromFixtures } from "./stub.js";

// The shared suites of the memory and Azurite providers, on the user API client and its stub.
const TOKEN = "directory-suite-token";

async function startStub() {
  return startUserApiStub({ data: await stubDataFromFixtures(), token: TOKEN, port: 0 });
}

describeUserDirectorySuite("surveyjs-api (stub)", async () => {
  const stub = await startStub();
  const { users } = createSurveyjsApiDirectory({ baseUrl: stub.url, token: TOKEN });
  return { users, close: () => stub.close() };
});

describeLicenceNoticeSuite("surveyjs-api (stub)", async (now) => {
  const stub = await startStub();
  const { notices } = createSurveyjsApiDirectory({
    baseUrl: stub.url,
    token: TOKEN,
    accountNotices: "surveyjs-licenses",
    now,
  });
  return { notices, close: () => stub.close() };
});
