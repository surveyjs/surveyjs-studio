import { readFile } from "node:fs/promises";
import { Ajv2020, type SchemaObject, type ValidateFunction } from "ajv/dist/2020.js";
import ajvFormats from "ajv-formats";
import { parse } from "yaml";

type Json = Record<string, unknown>;

/** `$id` under which `components.schemas` are registered (as `$defs`) in Ajv. */
const COMPONENTS_ID = "urn:my-surveys:conformance:contract";
const PROBLEM_REF = `${COMPONENTS_ID}#/$defs/Problem`;
const PROBLEM_MEDIA_TYPE = "application/problem+json";
/** Every operation may be unimplemented in Phase 1, so 501 is always a Problem. */
const NOT_IMPLEMENTED = 501;

/** OpenAPI 3.1 Schema Object keywords that are not JSON Schema 2020-12 keywords. */
const OPENAPI_KEYWORDS = ["example", "discriminator", "xml", "externalDocs"];

export interface Validator {
  /**
   * Checks a response against the operation `method` + `pathTemplate` (a contract path
   * relative to `/api/v1`, e.g. `/surveys/{surveyId}`). Returns the problems; empty means it conforms.
   */
  check(method: string, pathTemplate: string, response: Response): Promise<string[]>;
  /** Checks a response of no particular operation (e.g. an unknown route) as a Problem. */
  checkProblem(response: Response): Promise<string[]>;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deref(doc: Json, value: unknown): unknown {
  let current = value;
  for (let hops = 0; isObject(current) && typeof current.$ref === "string"; hops += 1) {
    const ref = current.$ref;
    if (!ref.startsWith("#/") || hops > 16) throw new Error(`cannot resolve $ref ${ref}`);
    current = ref
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), doc);
  }
  return current;
}

/** Deep-copies a schema, pointing `#/components/schemas/X` at the registered components. */
function toAjvSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toAjvSchema);
  if (!isObject(value)) return value;
  const out: Json = {};
  for (const [key, child] of Object.entries(value)) {
    const match =
      key === "$ref" && typeof child === "string"
        ? /^#\/components\/schemas\/(.+)$/.exec(child)
        : null;
    out[key] = match ? `${COMPONENTS_ID}#/$defs/${match[1]}` : toAjvSchema(child);
  }
  return out;
}

function collectExtensionKeywords(value: unknown, found: Set<string>): Set<string> {
  if (Array.isArray(value)) for (const item of value) collectExtensionKeywords(item, found);
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith("x-")) found.add(key);
      collectExtensionKeywords(child, found);
    }
  }
  return found;
}

const mediaTypeOf = (header: string | null): string =>
  (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";

export async function createValidator(openapiPath: string): Promise<Validator> {
  const doc: unknown = parse(await readFile(openapiPath, "utf8"));
  if (!isObject(doc) || !isObject(doc.paths)) throw new Error(`${openapiPath} has no paths`);
  const paths = doc.paths;
  const schemas =
    isObject(doc.components) && isObject(doc.components.schemas) ? doc.components.schemas : {};

  const ajv = new Ajv2020({
    strict: true,
    // Off: they reject valid 2020-12 composition such as `allOf: [{ $ref }, { required }]`.
    strictTypes: false,
    strictRequired: false,
    allowUnionTypes: true,
    allErrors: true,
  });
  ajvFormats.default(ajv);
  for (const keyword of [...OPENAPI_KEYWORDS, ...collectExtensionKeywords(doc, new Set())]) {
    ajv.addKeyword(keyword);
  }
  ajv.addSchema({ $id: COMPONENTS_ID, $defs: toAjvSchema(schemas) } as SchemaObject);

  const compiled = new Map<unknown, ValidateFunction>();
  const compile = (schema: unknown): ValidateFunction => {
    let validate = compiled.get(schema);
    if (!validate) {
      validate = ajv.compile(toAjvSchema(schema) as SchemaObject);
      compiled.set(schema, validate);
    }
    return validate;
  };
  const problemSchema = { $ref: PROBLEM_REF };
  const problemValidate = ajv.compile(problemSchema);
  // Compile every component now, so a contract Ajv cannot handle fails here.
  for (const name of Object.keys(schemas)) ajv.getSchema(`${COMPONENTS_ID}#/$defs/${name}`);

  const readJson = async (response: Response): Promise<{ body?: unknown; error?: string }> => {
    const text = await response.clone().text();
    try {
      return { body: JSON.parse(text) };
    } catch {
      return { error: "body is not valid JSON" };
    }
  };

  const checkBody = async (
    response: Response,
    mediaType: string,
    validate: ValidateFunction,
  ): Promise<string[]> => {
    const { body, error } = await readJson(response);
    if (error) return [error];
    const problems: string[] = [];
    if (!validate(body)) {
      for (const e of validate.errors ?? [])
        problems.push(`body${e.instancePath} ${e.message ?? "is invalid"}`);
    }
    if (mediaType === PROBLEM_MEDIA_TYPE && isObject(body) && body.status !== response.status) {
      problems.push(
        `Problem status ${String(body.status)} differs from HTTP status ${response.status}`,
      );
    }
    return problems;
  };

  const checkProblem = async (response: Response): Promise<string[]> => {
    const contentType = mediaTypeOf(response.headers.get("content-type"));
    if (contentType !== PROBLEM_MEDIA_TYPE) {
      return [`content type "${contentType}" is not ${PROBLEM_MEDIA_TYPE}`];
    }
    return checkBody(response, contentType, problemValidate);
  };

  return {
    checkProblem,
    async check(method, pathTemplate, response) {
      const item = paths[pathTemplate];
      const operation = isObject(item) ? item[method.toLowerCase()] : undefined;
      if (!isObject(operation)) return [`${method} ${pathTemplate} is not in the contract`];

      const responses = isObject(operation.responses) ? operation.responses : {};
      const status = String(response.status);
      const documented = responses[status] ?? responses.default;
      if (documented === undefined) {
        // R3: an operation need not document 501; it must still be a valid Problem.
        if (response.status === NOT_IMPLEMENTED) return checkProblem(response);
        return [`status ${status} is not documented for ${method} ${pathTemplate}`];
      }

      const content = deref(doc, documented);
      const media = isObject(content) && isObject(content.content) ? content.content : {};
      const mediaTypes = Object.keys(media);
      const contentType = mediaTypeOf(response.headers.get("content-type"));
      if (mediaTypes.length === 0) {
        return (await response.clone().text()) === "" ? [] : [`status ${status} documents no body`];
      }
      if (!mediaTypes.includes(contentType)) {
        return [`content type "${contentType}" is not one of: ${mediaTypes.join(", ")}`];
      }
      const entry = media[contentType];
      const schema = isObject(entry) ? entry.schema : undefined;
      if (schema === undefined) return [];
      return checkBody(response, contentType, compile(schema));
    },
  };
}
