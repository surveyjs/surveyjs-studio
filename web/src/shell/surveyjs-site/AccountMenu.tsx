import type { ShellAppLink, ShellProps, ShellUser } from "../types";
import { AppMenuItem, DropDownMenuItem, DropDownMenuSeparator } from "./DropDownMenuItem";
import { DropDownTopMenuItem } from "./DropDownTopMenuItem";
import { iconHtml } from "./icons";
import { Icon } from "./SiteIcon";
import styles from "./SurveyjsSiteShell.module.css";

export interface AccountMenuItemsProps {
  /** The `/config.links` map; `settings`, `helpDesk` and `billing` are the Account menu's links. */
  links: Record<string, string>;
  onSignOut: () => void;
  signingOut?: boolean;
  /** Marks Settings with the site's licence warning (a licence expired or expires soon). */
  licenceWarning?: boolean;
  /** The app's Projects page, listed after Settings (the site has no such item). */
  projectsLink?: ShellAppLink;
  /** The app's change-password page, after Projects (an instance with passwords). */
  changePasswordLink?: ShellAppLink;
  /** The app's Users page, after Projects (an instance admin). */
  usersLink?: ShellAppLink;
}

/**
 * The items of the site's Account menu: Settings,
 * the app's Projects, Users and Change password, Help Desk, Billing, a separator and Sign Out. An item whose link is not
 * configured is left out.
 */
export function AccountMenuItems({
  links,
  onSignOut,
  signingOut,
  licenceWarning,
  projectsLink,
  changePasswordLink,
  usersLink,
}: AccountMenuItemsProps) {
  const link = (name: string) => (Object.hasOwn(links, name) ? links[name] : undefined);
  const settings = link("settings");
  const helpDesk = link("helpDesk");
  const billing = link("billing");
  const manageClass = licenceWarning
    ? "v2-class---drop-down-menu-item--manage v2-class---drop-down-menu-item--manage-warning"
    : "v2-class---drop-down-menu-item--manage";
  return (
    <>
      {settings !== undefined && (
        <div className={manageClass}>
          <DropDownMenuItem text="Settings" url={settings} external={false} />
          <div
            className="v2-class---drop-down-menu-item--manage__warning-icon"
            dangerouslySetInnerHTML={iconHtml("Warning-24-24")}
          />
        </div>
      )}
      {projectsLink && <AppMenuItem text="Projects" link={projectsLink} />}
      {usersLink && <AppMenuItem text="Users" link={usersLink} />}
      {changePasswordLink && <AppMenuItem text="Change password" link={changePasswordLink} />}
      {helpDesk !== undefined && <DropDownMenuItem text="Help Desk" url={helpDesk} external />}
      {billing !== undefined && <DropDownMenuItem text="Billing" url={billing} external={false} />}
      <DropDownMenuSeparator />
      <DropDownMenuItem text="Sign Out" url="#" onClick={onSignOut} disabled={signingOut} />
    </>
  );
}

/** The user's avatar in the site's small icon box, or the site's own account icon without one. */
export function AccountIcon({ user }: { user: ShellUser }) {
  if (!user.avatarUrl) return <Icon name="top-bar/Sign-In" />;
  return (
    <div className="v2-class---icon v2-class---icon--small">
      <img className={styles.avatar} src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
    </div>
  );
}

export type AccountMenuProps = Pick<ShellProps, "user" | "onSignOut" | "signingOut"> &
  AccountMenuItemsProps & {
    /** Twinkles the account icon, as the site does while a licence dialog is not dismissed. */
    twinkling?: boolean;
  };

/**
 * The top bar's Account drop-down (as the site's top-bar item markup, type `Drop-Down`, with the
 * `v2-class---top-menu-item--drop-down-account` modifier). It shows the user's avatar and name where
 * the site shows its account icon and the word "Account".
 */
export function AccountMenu({ user, twinkling, ...items }: AccountMenuProps) {
  const iconClass = twinkling
    ? "v2-class---top-menu-item__icon v2-class---top-menu-item__icon--twinkling"
    : "v2-class---top-menu-item__icon";
  return (
    <DropDownTopMenuItem
      label="Account"
      modifier="v2-class---top-menu-item--drop-down-account"
      menuModifier="v2-class---drop-down-menu--account"
      trigger={
        <>
          <span className={iconClass}>
            <AccountIcon user={user} />
          </span>
          <span className="v2-class---top-menu-item__text">{user.displayName}</span>
        </>
      }
    >
      <ul className="v2-class---drop-down-menu__list">
        <AccountMenuItems {...items} />
      </ul>
    </DropDownTopMenuItem>
  );
}
