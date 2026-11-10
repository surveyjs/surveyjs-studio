import { PageHeader } from "../surveyList/PageHeader";
import { AccountPage } from "./AccountForm";
import { PROVIDER_NAMES, isExternalMethod } from "./authMethods";

const NOT_INVITED =
  "This instance is open to invited people only. Ask a project admin or the person who runs it to invite your email address, then sign in again.";

function refusalText(reason: string | undefined, provider: string | undefined): string {
  const name = isExternalMethod(provider) ? PROVIDER_NAMES[provider] : undefined;
  if (reason === "email-unverified") {
    const account = name ?? "sign-in";
    return `Your ${account} account didn't share a verified email address. Verify it with ${account}, or sign in another way.`;
  }
  if (reason === "disabled")
    return "This account is disabled. Ask the person who runs this instance.";
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
}: {
  reason: string | undefined;
  provider: string | undefined;
}) {
  return (
    <AccountPage>
      <PageHeader title="You can't sign in yet" />
      <p className="v2-class---paragraph">{refusalText(reason, provider)}</p>
      <p className="v2-class---paragraph">
        <a className="v2-class---paragraph-link" href="/sign-in">
          Back to sign in
        </a>
      </p>
    </AccountPage>
  );
}
