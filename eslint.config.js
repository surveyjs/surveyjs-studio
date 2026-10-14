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
    // The azure-legacy provider reads the live surveyjs.io stores: keep it read-only by
    // construction (Step 2). Lift a rule only together with the step that adds writes.
    files: ["server/src/providers/azure-legacy/**/*.ts"],
    ignores: ["**/*.test.ts"],
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
