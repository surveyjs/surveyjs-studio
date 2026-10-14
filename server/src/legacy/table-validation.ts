import type { LegacyTable } from "../providers/azure-legacy/fixtures.js";

/** Edm types the loader knows how to write. */
export const SUPPORTED_EDM_TYPES = [
  "Edm.String",
  "Edm.Guid",
  "Edm.DateTime",
  "Edm.Boolean",
  "Edm.Int32",
  "Edm.Int64",
  "Edm.Double",
] as const;
export type SupportedEdmType = (typeof SUPPORTED_EDM_TYPES)[number];

const ANNOTATION = "@odata.type";

/** Properties that must carry an annotation, by table kind (layout 3.5 to 3.8). */
const REQUIRED: { test: RegExp; guids: string[]; dates: string[]; optionalGuids: string[] }[] = [
  {
    test: /^postdelete/,
    guids: ["id", "postid", "surveyid", "instanceid"],
    dates: ["happendat"],
    optionalGuids: [],
  },
  { test: /^post/, guids: ["id", "postid", "surveyid"], dates: ["happendat"], optionalGuids: [] },
  {
    test: /^surveys$/,
    guids: ["id", "surveyid"],
    dates: ["happendat"],
    optionalGuids: ["postid", "resultid", "userid", "creatorid"],
  },
];

export function isSupportedEdmType(value: unknown): value is SupportedEdmType {
  return typeof value === "string" && (SUPPORTED_EDM_TYPES as readonly string[]).includes(value);
}

/** Returns one message per problem (empty when the tables are fine). Pure. */
export function validateFixtureTables(tables: readonly LegacyTable[]): string[] {
  const problems: string[] = [];
  for (const table of tables) {
    const file = `tables/${table.account}/${table.name}.json`;
    const rule = REQUIRED.find((candidate) => candidate.test.test(table.name));
    table.entities.forEach((entity, row) => {
      const where = `${file}, row ${row}`;
      for (const key of Object.keys(entity)) {
        if (!key.endsWith(ANNOTATION)) continue;
        if (!isSupportedEdmType(entity[key])) {
          problems.push(
            `${where}, property "${key.slice(0, -ANNOTATION.length)}": unsupported ${ANNOTATION} ` +
              `${JSON.stringify(entity[key])}`,
          );
        }
      }
      if (!rule) return;
      const expect = (property: string, type: string, required: boolean) => {
        if (!required && !(property in entity)) return;
        const actual = entity[`${property}${ANNOTATION}`];
        if (actual !== undefined && !isSupportedEdmType(actual)) return; // already reported above
        if (actual !== type) {
          problems.push(`${where}, property "${property}": must be annotated ${type}`);
        }
      };
      for (const property of rule.guids) expect(property, "Edm.Guid", true);
      for (const property of rule.dates) expect(property, "Edm.DateTime", true);
      for (const property of rule.optionalGuids) expect(property, "Edm.Guid", false);
    });
  }
  return problems;
}
