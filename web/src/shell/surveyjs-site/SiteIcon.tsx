import { iconHtml } from "./icons";

/** The site's `components/circle-icon/Icon` partial: an icon box, small unless `size` is given. */
export function Icon({
  name,
  type,
  size = "small",
}: {
  name: string;
  type?: string;
  size?: string;
}) {
  const typeClass = type ? ` v2-class---icon--${type.toLowerCase()}` : "";
  return (
    <div
      className={`v2-class---icon v2-class---icon--${size.toLowerCase()}${typeClass}`}
      dangerouslySetInnerHTML={iconHtml(name)}
    />
  );
}

/** The site's `components/circle-icon/Circle-Icon` partial: an icon on a tinted circle. */
export function CircleIcon({ name, type }: { name: string; type?: string }) {
  const typeClass = type ? ` v2-class---circle-icon--${type.toLowerCase()}` : "";
  const iconTypeClass = type ? ` v2-class---circle-icon__icon--${type.toLowerCase()}` : "";
  return (
    <div className={`v2-class---circle-icon v2-class---circle-icon--small${typeClass}`}>
      <div
        className={`v2-class---circle-icon__icon v2-class---circle-icon__icon--small${iconTypeClass}`}
        dangerouslySetInnerHTML={iconHtml(name)}
      />
    </div>
  );
}
