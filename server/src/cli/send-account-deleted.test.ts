import { describe, expect, it } from "vitest";
import { verifyWebhook } from "../accounts/webhook.js";
import { webhookKey } from "../accounts/webhook-secret.js";
import { run, USAGE } from "./send-account-deleted.js";

// A synthetic secret (the Standard Webhooks test vector's).
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const USER = "11111111-0000-4000-8000-a00000000006";
const NOW = Date.parse("2026-10-19T10:00:00.000Z");

interface Sent {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string;
}

async function send(
  argv: string[],
  options: { env?: Record<string, string>; status?: number; answer?: string } = {},
) {
  const sent: Sent[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const fakeFetch = (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(input),
      method: init?.method,
      headers: { ...(init?.headers as Record<string, string>) },
      body: String(init?.body),
    });
    const status = options.status ?? 204;
    return Promise.resolve(
      new Response(status === 204 ? null : (options.answer ?? ""), { status }),
    );
  };
  const code = await run(
    argv,
    { out: (t) => out.push(t), err: (t) => err.push(t) },
    {
      env: options.env ?? { ACCOUNT_WEBHOOK_SECRET: SECRET },
      fetch: fakeFetch as typeof fetch,
      now: () => NOW,
    },
  );
  return { code, sent, out: out.join(""), err: err.join("") };
}

const verify = (request: Sent) =>
  verifyWebhook(
    {
      id: request.headers["webhook-id"],
      timestamp: request.headers["webhook-timestamp"],
      signature: request.headers["webhook-signature"],
      body: request.body,
    },
    webhookKey(SECRET),
    NOW,
  );

describe("webhook:account-deleted", () => {
  it("sends a signed account.deleted event to the local server", async () => {
    const r = await send(["--user", USER]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("HTTP 204\n");
    expect(r.sent).toHaveLength(1);
    const [request] = r.sent;
    expect(request!.url).toBe("http://127.0.0.1:3000/api/v1/webhooks/account-deleted");
    expect(request!.method).toBe("POST");
    expect(request!.body).toBe(`{"type":"account.deleted","data":{"userId":"${USER}"}}`);
    expect(request!.headers["content-type"]).toBe("application/json");
    expect(request!.headers["webhook-id"]).toMatch(
      /^msg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(request!.headers["webhook-timestamp"]).toBe(String(NOW / 1000));
    expect(verify(request!)).toBe("valid");
  });

  it("sends to --url", async () => {
    const r = await send(["--user", USER, "--url", "http://localhost:4000/"]);
    expect(r.sent[0]!.url).toBe("http://localhost:4000/api/v1/webhooks/account-deleted");
  });

  it("signs with a random key for --bad-signature", async () => {
    const r = await send(["--user", USER, "--bad-signature"], { status: 401, answer: "{}" });
    expect(verify(r.sent[0]!)).toBe("bad-signature");
  });

  it("prints the status and the body of a refusal and exits 1", async () => {
    const answer = '{"code":"invalid-signature","status":401}';
    const r = await send(["--user", USER], { status: 401, answer });
    expect(r.code).toBe(1);
    expect(r.out).toBe(`HTTP 401\n${answer}\n`);
  });

  it.each([
    ["missing", {}],
    ["not a whsec_ secret", { ACCOUNT_WEBHOOK_SECRET: "plain-text-secret-value" }],
  ])("exits 2 without sending when the secret is %s, never printing it", async (_name, env) => {
    const r = await send(["--user", USER], { env });
    expect(r.code).toBe(2);
    expect(r.sent).toEqual([]);
    expect(r.err).toContain("ACCOUNT_WEBHOOK_SECRET");
    expect(r.err).not.toContain("plain-text-secret-value");
    expect(r.out).toBe("");
  });

  it.each([[["--user", "erasable@example.com"]], [[]], [["--user", USER, "--url", "not a url"]]])(
    "exits 2 with the usage for %j",
    async (argv) => {
      const r = await send(argv);
      expect(r.code).toBe(2);
      expect(r.sent).toEqual([]);
      expect(r.err).toContain(USAGE);
    },
  );

  it("starts the usage with the command line", () => {
    expect(USAGE.split("\n")[0]).toBe(
      "Usage: pnpm webhook:account-deleted --user <id> [--url <origin>] [--bad-signature] [--env-file <path>]",
    );
  });
});
