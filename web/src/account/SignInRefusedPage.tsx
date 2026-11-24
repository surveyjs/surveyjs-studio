import { PageHeader } from "../surveyList/PageHeader";
import { AccountPage } from "./AccountForm";
import { PROVIDER_NAMES, isExternalMethod } from "./authMethods";

const NOT_INVITED =
  "This instance is open to invited people only. Ask a project admin or the person who runs it to invite your email address, then sign in again.";

/** The hosted edition: an admin disabled the account in Studio; the site's block is `blocked`. */
const HOSTED_DISABLED =
  "This account has been disabled in SurveyJS Studio. Contact the administrator.";

function refusalText(
  reason: string | undefined,
  provider: string | undefined,
  hosted: boolean,
): string {
  const name = isExternalMethod(provider) ? PROVIDER_NAMES[provider] : undefined;
  if (reason === "email-unverified") {
    const account = name ?? "sign-in";
    return `Your ${account} account didn't share a verified email address. Verify it with ${account}, or sign in another way.`;
  }
  if (reason === "disabled") {
    return hosted
      ? HOSTED_DISABLED
      : "This account is disabled. Ask the person who runs this instance.";
  }
  // Hosted sign-in through surveyjs.io (ADR 0043): the site's block, and an email whose account
  // belongs to another surveyjs.io id.
  if (reason === "blocked") {
    return "This surveyjs.io account is blocked. Contact SurveyJS support if you think this is a mistake.";
  }
  if (reason === "identity-conflict") {
    return "This email is already used by another surveyjs.io account in SurveyJS Studio. If you recreated your surveyjs.io account, you can sign in once the old one has been removed.";
  }
  if (reason === "cancelled") {
    const at = name === undefined ? "" : ` at ${name}`;
    return `You cancelled the sign-in${at}. Sign in again, or choose another way.`;
  }
  if (reason === "unavailable") {
    return `${name ?? "The sign-in provider"} could not be reached. Try again in a few minutes, or sign in another way.`;
  }
  if (reason === "read-only")
    return "This instance is read-only for maintenance, so first sign-ins are paused. Try again later.";
  if (reason === "expired")
    return "The sign-in took too long, or it started in another browser. Sign in again.";
  if (reason === "failed") {
    const at = name === undefined ? "" : ` with ${name}`;
    return `The sign-in${at} could not be completed. Sign in again, or choose another way.`;
  }
  return NOT_INVITED;
}

/** Where the server sends a sign-in it refused (`/sign-in/refused?reason=&provider=`). */
export function SignInRefusedPage({
  reason,
  provider,
  hosted = false,
}: {
  reason: string | undefined;
  provider: string | undefined;
  /** The hosted edition (`/config` `edition`). */
  hosted?: boolean;
}) {
  return (
    <AccountPage>
      <PageHeader title="You can't sign in yet" />
      <p className="v2-class---paragraph">{refusalText(reason, provider, hosted)}</p>
      <p className="v2-class---paragraph">
        <a className="v2-class---paragraph-link" href="/sign-in">
          Back to sign in
        </a>
      </p>
    </AccountPage>
  );
}
