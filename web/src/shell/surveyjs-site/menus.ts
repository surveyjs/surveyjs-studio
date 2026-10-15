import { MY_SURVEYS_URL } from "./site";

/** One entry of a top-bar drop-down menu, as in the site's `V2/top-bar/Drop-Down-Menu-*` partials. */
export type MenuEntry =
  | {
      text: string;
      url: string;
      icon?: string;
      iconType?: string;
      tag?: string;
      classMod?: string;
    }
  | "separator";

export interface MenuGroup {
  /** The group title shown in the mobile menu (the desktop drop-downs hide it). */
  title: string;
  entries: MenuEntry[];
}

const circle = (name: string) => `top-bar/circle-icons/${name}`;

/** `the site's page markup` */
export const productsMenu: MenuGroup = {
  title: "Products",
  entries: [
    {
      text: "Form Library",
      icon: circle("Survey-Runner"),
      iconType: "Secondary",
      url: "/form-library",
    },
    {
      text: "Survey Creator",
      icon: circle("Survey-Creator"),
      iconType: "Primary",
      url: "/open-source",
    },
    {
      text: "Dashboard",
      icon: circle("Analytics-Pack"),
      iconType: "Blue-Light",
      url: "/dashboard",
    },
    {
      text: "PDF Generator",
      icon: circle("Export-To-PDF"),
      iconType: "Red-Light",
      url: "/pdf-generator",
    },
    "separator",
    {
      text: "WordPress Plugin",
      icon: circle("Wordpress"),
      iconType: "Blue-Light",
      url: "https://wordpress.org/plugins/surveyjs/",
    },
    {
      text: "Partner Solutions",
      icon: circle("Partner-Solutions"),
      iconType: "Primary",
      url: "/partner-solutions",
    },
    {
      text: "All-In-One Demo",
      icon: circle("Online-Survey-Tool"),
      iconType: "Secondary",
      url: "/free-survey-tool",
    },
    "separator",
    {
      text: "Features",
      icon: "top-bar/Features",
      iconType: "Secondary",
      url: "/features",
      classMod: "v2-class---drop-down-menu-item--features",
    },
  ],
};

/** `the site's page markup` for a signed-in user. */
export const demosMenu: MenuGroup = {
  title: "Demos",
  entries: [
    {
      text: "Form Library",
      icon: circle("Survey-Runner"),
      iconType: "Secondary",
      url: "/form-library/examples/overview",
    },
    {
      text: "Survey Creator",
      icon: circle("Survey-Creator"),
      iconType: "Primary",
      url: "/survey-creator/examples/free-nps-survey-template/reactjs",
    },
    {
      text: "Dashboard",
      icon: circle("Analytics-Pack"),
      iconType: "Blue-Light",
      url: "/dashboard/examples/interactive-survey-data-dashboard",
    },
    {
      text: "PDF Generator",
      icon: circle("Export-To-PDF"),
      iconType: "Red-Light",
      url: "/pdf-generator/examples/save-completed-forms-as-pdf-files/reactjs",
    },
    "separator",
    // For a signed-in user the site links the all-in-one demo to My Surveys.
    {
      text: "All-in-One Demo",
      icon: circle("All-In-One-Demo"),
      iconType: "Gray",
      url: MY_SURVEYS_URL,
    },
    "separator",
    {
      text: "NodeJS / ASP.NET / PHP Servers",
      icon: circle("N-A-P-Servers"),
      iconType: "Gray",
      url: "/backend-integration/examples",
    },
    {
      text: "Bootstrap / Material UI / shadcn/ui",
      tag: "new",
      icon: circle("Theme-Adapters"),
      iconType: "Gray",
      url: "/themes/theme-adapters",
    },
    "separator",
    { text: "Try Yourself", icon: circle("Try-Yourself"), iconType: "Primary", url: "/try" },
  ],
};

/** `the site's page markup` */
export const newDemosMenu: MenuGroup = {
  title: "New & Updated Demos",
  entries: [
    {
      text: "Multi-User Form Editing",
      tag: "new",
      url: "/survey-creator/examples/collaborative-survey-creator",
    },
    {
      text: "Multi-User Form Filling",
      tag: "new",
      url: "/form-library/examples/collaborative-survey",
    },
    { text: "UI Preset Editor", tag: "new", url: "/survey-creator/examples/ui-preset-editor" },
    {
      text: "Apply a Theme to a PDF Form",
      tag: "new",
      url: "/pdf-generator/examples/apply-surveyjs-theme-to-pdf-form",
    },
    {
      text: "Paper Form Data Extraction",
      tag: "new",
      url: "/form-library/examples/extract-data-from-paper-forms-pdf",
    },
  ],
};

/** `the site's page markup` (the "Developers" drop-down). */
export const guidesMenu: MenuGroup = {
  title: "Guides",
  entries: [
    {
      text: "Documentation",
      icon: circle("Documentation"),
      iconType: "Secondary",
      url: "/documentation",
    },
    {
      text: "Setup Guides for My Stack",
      icon: circle("Find-Guides-For-My-Stack"),
      iconType: "Primary",
      url: "/find-surveyjs-guides-for-my-stack",
    },
    { text: "FAQ", icon: circle("FAQ"), iconType: "Blue-Light", url: "/faq" },
    { text: "Support", icon: circle("Support"), iconType: "Secondary", url: "/support" },
    {
      text: "Source Code on GitHub",
      icon: circle("GitHub-Repositories"),
      iconType: "Primary",
      url: "https://github.com/surveyjs",
    },
    {
      text: "Changelog",
      icon: circle("Change-Log"),
      iconType: "Blue-Light",
      url: "/stay-updated/release-notes",
    },
    { text: "Licensing", icon: "top-bar/Licensing", iconType: "Red-Light", url: "/licensing" },
  ],
};

/** `the site's page markup` */
export const industriesMenu: MenuGroup = {
  title: "Industries",
  entries: [
    { text: "Healthcare", icon: circle("Healthcare"), iconType: "Red-Light", url: "/healthcare" },
    {
      text: "Human Resources",
      icon: circle("HR"),
      iconType: "Blue-Light",
      url: "/human-resources",
    },
    { text: "Education", icon: circle("Education"), iconType: "Secondary", url: "/education" },
    {
      text: "Market Research",
      icon: circle("Market-Research"),
      iconType: "Primary",
      url: "/market-research",
    },
  ],
};

const updated = (name: string) => circle(`stay-updated/${name}`);

/** `the site's page markup` */
export const stayUpdatedMenu: MenuGroup = {
  title: "Stay Updated",
  entries: [
    { text: "Blog", icon: updated("Blog"), iconType: "Primary", url: "/stay-updated" },
    {
      text: "Release Notes",
      icon: updated("Release-Notes"),
      iconType: "Blue-Light",
      url: "/stay-updated/release-notes",
    },
    {
      text: "Breaking Changes",
      icon: updated("Breaking-Changes"),
      iconType: "Secondary",
      url: "/stay-updated/breaking-changes",
    },
    {
      text: "Major Updates",
      icon: updated("Major-Updates"),
      iconType: "Secondary",
      url: "/stay-updated/major-updates/2025-2026",
    },
    {
      text: "Roadmap",
      icon: updated("Roadmap"),
      iconType: "Secondary",
      url: "/stay-updated/roadmap",
    },
    {
      text: "Case Studies",
      icon: updated("Case-Studies"),
      iconType: "Blue-Light",
      url: "/stay-updated/case-studies",
    },
    "separator",
    {
      text: "Tutorials",
      icon: updated("Tutorials"),
      iconType: "Red-Light",
      url: "/stay-updated/tutorials",
    },
    {
      text: "White Papers",
      icon: updated("White-Papers"),
      iconType: "Primary",
      url: "/stay-updated/white-papers",
    },
    {
      text: "Migration Guides",
      icon: updated("Migration-Guides"),
      iconType: "Blue-Light",
      url: "/stay-updated/migration-guides",
    },
  ],
};

/** `the site's page markup` (first group of the mobile menu). */
export const otherMenu: MenuGroup = {
  title: "",
  entries: [
    { text: "Features", icon: circle("Features"), iconType: "Secondary", url: "/features" },
    { text: "Pricing", icon: circle("Pricing"), iconType: "Primary", url: "/pricing" },
  ],
};
