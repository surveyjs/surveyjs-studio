import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/blob-report/**",
      "**/generated/**",
      "web/src/routeTree.gen.ts",
      ".superpowers/**",
      ".claude/**",
      ".agents/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ["web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    // The azure-legacy provider works on the live surveyjs.io stores: keep it read-only by
    // construction (Step 2). Every write lives in writes.ts, the one file listed in `ignores`;
    // add a write there only together with the step that needs it.
    files: ["server/src/providers/azure-legacy/**/*.ts"],
    ignores: [
      "**/*.test.ts",
      // the only file allowed to write to the legacy stores; Step 4: survey creation; Step 5: update, clone and delete; Step 6: definition and theme saves; Step 7: editor files and clone rewriting; Step 8: result rows and completion markers; Step 9: results layouts (views) in a container of our own; Step 10: deleting all results and the public-question list; Step 11: projects and members (Organizations and OrganizationUsers rows, project deletion)
      "server/src/providers/azure-legacy/writes.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name=/^(create|delete|upsert|update|upload|append|set|put|insert|merge|submit|commit|begin|start|abort|undelete|drop|clear|batch|bulk|execute|copy|move|rename|stage)/i]",
          message: "The azure-legacy provider is read-only: no write calls to the legacy stores.",
        },
        {
          selector: "NewExpression[callee.property.name=/^(Transaction|PreparedStatement|Table)$/]",
          message:
            "The azure-legacy provider is read-only: no transactions, prepared statements or bulk tables.",
        },
        {
          selector:
            "Literal[value=/\\b(insert|update|delete|merge|drop|create|alter|truncate|exec|execute|grant|into)\\b/i]",
          message: "The azure-legacy provider is read-only: SQL text must be SELECT only.",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\b(insert|update|delete|merge|drop|create|alter|truncate|exec|execute|grant|into)\\b/i]",
          message: "The azure-legacy provider is read-only: SQL text must be SELECT only.",
        },
      ],
    },
  },
);
