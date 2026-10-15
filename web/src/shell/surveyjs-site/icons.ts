// The site's icons are Razor partials that hold one inline <svg> each. The copies under
// assets/site/Views/Shared/V2/_icons/ keep their names with an .svg extension.
const files = import.meta.glob<string>("./assets/site/Views/Shared/V2/_icons/**/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

const PREFIX = "./assets/site/Views/Shared/V2/_icons/";

/**
 * The markup of a site icon, by its partial name below `V2/_icons/` (`top-bar/GitHub`), for
 * `dangerouslySetInnerHTML`. The markup is a copied static asset, never user input.
 */
export function iconHtml(name: string): { __html: string } {
  const svg = files[`${PREFIX}${name}.svg`];
  if (svg === undefined) throw new Error(`Unknown surveyjs.io icon: ${name}`);
  return { __html: svg };
}
