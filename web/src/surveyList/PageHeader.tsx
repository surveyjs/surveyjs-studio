/** The site's `V2/components/Header` partial as the My Surveys page uses it (size 1, reduced). */
export function PageHeader({ title }: { title: string }) {
  return (
    <header className="v2-class---header v2-class---header--level-1 v2-class---header--reduced">
      <h1 className="v2-class---header__title v2-class---header__title--level-1">{title}</h1>
    </header>
  );
}
