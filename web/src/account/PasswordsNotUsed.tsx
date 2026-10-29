import { PageHeader } from "../surveyList/PageHeader";

/** The set-password and change-password pages on a site without passwords (AUTH_METHODS). */
export function PasswordsNotUsed({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <p className="v2-class---paragraph">This site does not use passwords.</p>
    </>
  );
}
