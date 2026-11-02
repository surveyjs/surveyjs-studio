import { PageHeader } from "../surveyList/PageHeader";
import { PROVIDER_NAMES, isExternalMethod } from "./authMethods";

const NOT_INVITED =
  "This instance is open to invited people only. Ask a project admin or the person who runs it to invite your email address, then sign in again.";

function refusalText(reason: string | undefined, provider: string | undefined): string {
  if (reason === "email-unverified") {
    const name = isExternalMethod(provider) ? PROVIDER_NAMES[provider] : "sign-in";
    return `Your ${name} account didn't share a verified email address. Verify it with ${name}, or sign in another way.`;
  }
  if (reason === "disabled")
    return "This account is disabled. Ask the person who runs this instance.";
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
    <>
      <PageHeader title="You can't sign in yet" />
      <p className="v2-class---paragraph">{refusalText(reason, provider)}</p>
      <p className="v2-class---paragraph">
        <a className="v2-class---paragraph-link" href="/sign-in">
          Back to sign in
        </a>
      </p>
    </>
  );
}
