import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ShellAppLink } from "../types";
import { AccountIcon, AccountMenu, AccountMenuItems, type AccountMenuProps } from "./AccountMenu";
import {
  DropDownMenuGroupTitle,
  DropDownMenuItem,
  DropDownMenuSeparator,
} from "./DropDownMenuItem";
import { DropDownTopMenuItem } from "./DropDownTopMenuItem";
import { iconHtml } from "./icons";
import {
  demosMenu,
  guidesMenu,
  industriesMenu,
  newDemosMenu,
  otherMenu,
  productsMenu,
  stayUpdatedMenu,
  type MenuEntry,
  type MenuGroup,
} from "./menus";
import { MY_SURVEYS_URL, siteUrl } from "./site";
import { SiteButton } from "./SiteButton";
import { Icon } from "./SiteIcon";

/**
 * The site's GitHub star count is fetched from the GitHub API on the server. My Surveys makes no
 * such call: it shows the site's own fallback value (`GitHubStarsProvider`).
 */
const GITHUB_STARS = "4.7k";

export type MobileMenu = "main" | "account";

export type HeaderProps = AccountMenuProps & {
  /** The open mobile menu (tablet and phone widths), if any. */
  mobileMenu: MobileMenu | null;
  onMobileMenu: (menu: MobileMenu | null) => void;
};

/**
 * The site's top bar: the bar at the top of the page, the same bar
 * fixed to the top once the first one scrolls away, and the mobile menus.
 */
export function Header(props: HeaderProps) {
  const { mobileMenu, onMobileMenu } = props;
  const intersection = useRef<HTMLDivElement>(null);
  const [scrolledAway, setScrolledAway] = useState(false);

  useEffect(() => {
    const target = intersection.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setScrolledAway(!entry.isIntersecting);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  // As on the site, an open mobile menu hides the fixed bar.
  const fixedShown = scrolledAway && mobileMenu === null;
  const close = () => onMobileMenu(null);
  // The page changes under the mobile menu, so the menu closes first.
  const closing = (link: ShellAppLink | undefined) =>
    link && {
      href: link.href,
      navigate: () => {
        close();
        link.navigate();
      },
    };

  return (
    <>
      <header className="v2-class---top-bar">
        <div className="v2-class---top-bar__intersection" ref={intersection}></div>
        <Title />
        <TopBarMenu {...props} />
      </header>

      <header
        className={
          fixedShown
            ? "v2-class---top-bar v2-class---top-bar--fixed v2-class---top-bar--fixed-shown"
            : "v2-class---top-bar v2-class---top-bar--fixed"
        }
        aria-hidden={!fixedShown}
        inert={!fixedShown}
      >
        <Title size="Small" />
        <TopBarMenu {...props} />
      </header>

      <div className={mobileMenuClass(mobileMenu === "main")} data-mobile-menu="main">
        {mobileMenu === "main" && <MobileMainMenu onClose={close} />}
      </div>

      <div className={mobileMenuClass(mobileMenu === "account")} data-mobile-menu="account">
        {mobileMenu === "account" && (
          <nav className="v2-class---drop-down-menu v2-class---drop-down-menu--mobile-menu">
            <div className="v2-class---drop-down-menu__list v2-class---drop-down-menu__list--groups v2-class---drop-down-menu__list--mobile v2-class---drop-down-menu__list--account-mobile">
              <ul className="v2-class---drop-down-menu__group-list">
                <CloseMobileMenu onClose={close} />
                <AccountMenuItems
                  links={props.links}
                  onSignOut={props.onSignOut}
                  signingOut={props.signingOut}
                  licenceWarning={props.licenceWarning}
                  projectsLink={closing(props.projectsLink)}
                  changePasswordLink={closing(props.changePasswordLink)}
                  usersLink={closing(props.usersLink)}
                />
              </ul>
            </div>
          </nav>
        )}
      </div>
    </>
  );
}

function mobileMenuClass(opened: boolean): string {
  return opened
    ? "v2-class---mobile-menu v2-class---mobile-menu--opened"
    : "v2-class---mobile-menu";
}

/** The site's top-bar title markup with the mono logo, linking to the surveyjs.io home page. */
function Title({ size }: { size?: "Small" }) {
  return (
    <div className="v2-class---top-bar__title">
      <a
        className={
          size ? `v2-class---logo v2-class---logo--${size.toLowerCase()}` : "v2-class---logo"
        }
        href={siteUrl("/")}
        aria-label="SurveyJS"
        dangerouslySetInnerHTML={iconHtml("top-bar/Logo-Mono")}
      />
    </div>
  );
}

/** The site's top-bar menu markup for a signed-in user. */
function TopBarMenu(props: HeaderProps) {
  const { user, twinkling, onMobileMenu } = props;
  const iconClass = twinkling
    ? "v2-class---top-menu-item__icon v2-class---top-menu-item__icon--twinkling"
    : "v2-class---top-menu-item__icon";
  return (
    <nav className="v2-class---top-bar-menu">
      <nav className="v2-class---top-bar-menu">
        <ul className="v2-class---top-bar-menu">
          <DropDownMenu text="Products">
            <ul className="v2-class---drop-down-menu__list">
              <MenuEntries entries={productsMenu.entries} />
            </ul>
          </DropDownMenu>

          <DropDownMenu text="Demos">
            <div className="v2-class---drop-down-menu__list v2-class---drop-down-menu__list--columns">
              <ul className="v2-class---drop-down-menu__column">
                <MenuEntries entries={demosMenu.entries} />
              </ul>
              <ul className="v2-class---drop-down-menu__column v2-class---drop-down-menu__column--new-demos">
                <MenuGroupEntries group={newDemosMenu} />
              </ul>
            </div>
          </DropDownMenu>

          <DropDownMenu text="Developers">
            <ul className="v2-class---drop-down-menu__list">
              <MenuEntries entries={guidesMenu.entries} />
            </ul>
          </DropDownMenu>

          <DropDownMenu text="Industries">
            <ul className="v2-class---drop-down-menu__list">
              <MenuEntries entries={industriesMenu.entries} />
            </ul>
          </DropDownMenu>

          <DropDownMenu text="Stay Updated">
            <ul className="v2-class---drop-down-menu__list">
              <MenuEntries entries={stayUpdatedMenu.entries} />
            </ul>
          </DropDownMenu>

          <li className="v2-class---top-menu-item v2-class---top-menu-item--text">
            <a href={siteUrl("/pricing")} className="v2-class---top-menu-item__link">
              Pricing
            </a>
          </li>
          <Separator />

          <IconWithTextItem
            icon="top-bar/GitHub"
            text={GITHUB_STARS}
            label="GitHub"
            url="https://github.com/surveyjs/survey-library"
          />
          <Separator />

          <IconWithTextItem icon="top-bar/Cart" text="Cart" url={siteUrl("/cart")} cart />

          <AccountMenu
            user={user}
            links={props.links}
            onSignOut={props.onSignOut}
            signingOut={props.signingOut}
            licenceWarning={props.licenceWarning}
            projectsLink={props.projectsLink}
            changePasswordLink={props.changePasswordLink}
            usersLink={props.usersLink}
            twinkling={twinkling}
          />

          <li
            className="v2-class---top-menu-item v2-class---top-menu-item--mobile-account v2-class---top-menu-item--icon-with-text v2-class---top-menu-item--menu"
            onClick={() => onMobileMenu("account")}
          >
            <span
              className="v2-class---top-menu-item--icon-with-text__content"
              role="button"
              tabIndex={0}
              aria-label="Account"
              onKeyDown={activateOnKey(() => onMobileMenu("account"))}
            >
              <span className={iconClass}>
                <AccountIcon user={user} />
              </span>
              <span className="v2-class---top-menu-item__text">{user.displayName}</span>
            </span>
          </li>

          <li className="v2-class---top-menu-item v2-class---top-menu-item--button">
            <SiteButton
              text="My Surveys"
              style="Accent"
              mode="Primary"
              size="X-Small"
              href={MY_SURVEYS_URL}
            />
          </li>

          <li
            className="v2-class---top-menu-item v2-class---top-menu-item--icon-with-text v2-class---top-menu-item--menu"
            onClick={() => onMobileMenu("main")}
          >
            <span
              className="v2-class---top-menu-item--icon-with-text__content"
              role="button"
              tabIndex={0}
              aria-label="Menu"
              onKeyDown={activateOnKey(() => onMobileMenu("main"))}
            >
              <span className="v2-class---top-menu-item__icon">
                <Icon name="top-bar/Menu" />
              </span>
              <span className="v2-class---top-menu-item__text">Menu</span>
            </span>
          </li>
        </ul>
      </nav>
    </nav>
  );
}

function activateOnKey(action: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      action();
    }
  };
}

/** A text item of the top bar with a drop-down menu. */
function DropDownMenu({ text, children }: { text: string; children: ReactNode }) {
  return (
    <DropDownTopMenuItem
      label={text}
      trigger={<span className="v2-class---top-menu-item__text">{text}</span>}
    >
      {children}
    </DropDownTopMenuItem>
  );
}

/** `Top-Menu-Item`, type `Icon-With-Text` (GitHub stars, Cart). */
function IconWithTextItem(props: {
  icon: string;
  text: string;
  url: string;
  label?: string;
  cart?: boolean;
}) {
  const className = props.cart
    ? "v2-class---top-menu-item v2-class---top-menu-item--cart v2-class---top-menu-item--icon-with-text"
    : "v2-class---top-menu-item v2-class---top-menu-item--icon-with-text";
  return (
    <li className={className}>
      <a
        href={props.url}
        className="v2-class---top-menu-item__link v2-class---top-menu-item--icon-with-text__content"
        aria-label={props.label ?? props.text}
      >
        <span className="v2-class---top-menu-item__icon">
          <Icon name={props.icon} />
        </span>
        <span className="v2-class---top-menu-item__text">{props.text}</span>
        {props.cart && (
          // The site fills the count from its cart API; My Surveys has no cart, so it stays empty
          // and hidden, as on the site with an empty cart.
          <span className="v2-class---top-menu-item__cart-count-container">
            <span className="v2-class---top-menu-item__cart-count"></span>
          </span>
        )}
      </a>
    </li>
  );
}

function Separator() {
  return (
    <div className="v2-class---top-menu-item v2-class---top-menu-item--separator">
      <div className="v2-class---top-menu-item__separator"></div>
    </div>
  );
}

function MenuEntries({ entries }: { entries: readonly MenuEntry[] }) {
  return entries.map((entry, index) =>
    entry === "separator" ? (
      <DropDownMenuSeparator key={index} />
    ) : (
      <DropDownMenuItem
        key={index}
        text={entry.text}
        url={entry.url}
        icon={entry.icon}
        iconType={entry.iconType}
        tag={entry.tag}
        classMod={entry.classMod}
      />
    ),
  );
}

/** A menu with its group title, as the mobile menu shows it. */
function MenuGroupEntries({ group }: { group: MenuGroup }) {
  return (
    <>
      <DropDownMenuGroupTitle text={group.title} />
      <MenuEntries entries={group.entries} />
    </>
  );
}

function CloseMobileMenu({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="v2-class---drop-down-menu__group-header v2-class---drop-down-menu__group-header--mobile"
      role="button"
      tabIndex={0}
      aria-label="Close"
      onClick={onClose}
      onKeyDown={activateOnKey(onClose)}
      dangerouslySetInnerHTML={iconHtml("top-bar/Close-32x32")}
    />
  );
}

/** The `MobileMenuMain` drop-down: every menu of the top bar, one group after another. */
function MobileMainMenu({ onClose }: { onClose: () => void }) {
  return (
    <nav className="v2-class---drop-down-menu v2-class---drop-down-menu--mobile-menu">
      <div className="v2-class---drop-down-menu__list v2-class---drop-down-menu__list--groups v2-class---drop-down-menu__list--mobile v2-class---drop-down-menu__list--main-mobile">
        <ul className="v2-class---drop-down-menu__group-list">
          <MenuEntries entries={otherMenu.entries} />
        </ul>
        <CloseMobileMenu onClose={onClose} />
        <ul className="v2-class---drop-down-menu__group-list">
          <MenuGroupEntries group={productsMenu} />
        </ul>
        <ul className="v2-class---drop-down-menu__group-list v2-class---drop-down-menu__group-list--demos">
          <MenuGroupEntries group={demosMenu} />
        </ul>
        <ul className="v2-class---drop-down-menu__group-list">
          <MenuGroupEntries group={newDemosMenu} />
        </ul>
        <ul className="v2-class---drop-down-menu__group-list">
          <MenuGroupEntries group={guidesMenu} />
        </ul>
        <ul className="v2-class---drop-down-menu__group-list">
          <MenuGroupEntries group={industriesMenu} />
        </ul>
        <ul className="v2-class---drop-down-menu__group-list">
          <MenuGroupEntries group={stayUpdatedMenu} />
        </ul>
      </div>
    </nav>
  );
}
