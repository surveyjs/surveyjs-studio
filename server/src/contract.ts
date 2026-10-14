import { readFile } from "node:fs/promises";
import { Ajv2020, type Options, type SchemaObject, type ValidateFunction } from "ajv/dist/2020.js";
import ajvFormats from "ajv-formats";
import { parse } from "yaml";

/** `$id` under which `components.schemas` are registered (as `$defs`) in Ajv. */
const COMPONENTS_ID = "urn:my-surveys:contract";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
type HttpMethod = Uppercase<(typeof HTTP_METHODS)[number]>;

/** OpenAPI 3.1 Schema Object keywords that are not JSON Schema 2020-12 keywords. */
const OPENAPI_KEYWORDS = ["example", "discriminator", "xml", "externalDocs"];

type Json = Record<string, unknown>;

export type HttpPart = "body" | "params" | "querystring" | "headers";

export interface RouteSchema {
  params?: SchemaObject;
  querystring?: SchemaObject;
  headers?: SchemaObject;
  body?: { content: Record<string, { schema: SchemaObject }> };
}

export interface ContractOperation {
  readonly operationId: string;
  readonly method: HttpMethod;
  /** Fastify route path relative to the API prefix, e.g. `/surveys/:surveyId`. */
  readonly url: string;
  readonly schema: RouteSchema;
  /** Media types the operation accepts as a body, or `undefined` if it takes none. */
  readonly requestBody?: { readonly required: boolean; readonly mediaTypes: readonly string[] };
}

export interface Contract {
  readonly operations: readonly ContractOperation[];
  /** Fastify validator compiler: JSON Schema 2020-12, with coercion everywhere but the body. */
  readonly compileValidator: (route: { schema: unknown; httpPart?: string }) => ValidateFunction;
}

/** JSON media types are parsed and validated; others reach the handler unparsed. */
export function isJsonMediaType(mediaType: string): boolean {
  return mediaType === "application/json" || /^application\/[\w.-]+\+json$/.test(mediaType);
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`OpenAPI contract: ${message}`);
}

/** Follows a local `$ref` (e.g. `#/components/parameters/Limit`) to its target. */
function deref(doc: Json, value: unknown): Json {
  let current = value;
  for (let hops = 0; isObject(current) && typeof current.$ref === "string"; hops += 1) {
    const ref = current.$ref;
    if (!ref.startsWith("#/") || hops > 16) fail(`cannot resolve $ref ${ref}`);
    current = ref
      .slice(2)
      .split("/")
      .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), doc);
  }
  return isObject(current) ? current : fail("expected an object");
}

/** Deep-copies a schema, pointing `#/components/schemas/X` at the registered components. */
function toAjvSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toAjvSchema);
  if (!isObject(value)) return value;
  const out: Json = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string") {
      const match = /^#\/components\/schemas\/(.+)$/.exec(child);
      out.$ref = match ? `${COMPONENTS_ID}#/$defs/${match[1]}` : fail(`unsupported $ref ${child}`);
    } else {
      out[key] = toAjvSchema(child);
    }
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

function createAjv(
  options: Options,
  components: SchemaObject,
  keywords: Iterable<string>,
): Ajv2020 {
  const ajv = new Ajv2020({
    // Unknown keywords and formats are errors. strictTypes/strictRequired are off (not
    // "log"): they reject valid 2020-12 composition such as `allOf: [{ $ref }, { required }]`,
    // where `type` and `properties` come from the referenced schema.
    strict: true,
    strictTypes: false,
    strictRequired: false,
    allowUnionTypes: true,
    allErrors: true,
    useDefaults: true,
    ...options,
  });
  ajvFormats.default(ajv);
  for (const keyword of keywords) ajv.addKeyword(keyword);
  ajv.addSchema(components);
  return ajv;
}

function objectSchema(params: readonly Json[], enforceRequired: boolean): SchemaObject | undefined {
  if (params.length === 0) return undefined;
  const properties: Json = {};
  const required: string[] = [];
  for (const param of params) {
    const name = param.in === "header" ? String(param.name).toLowerCase() : String(param.name);
    properties[name] = toAjvSchema(param.schema ?? {});
    if (param.required === true && enforceRequired) required.push(name);
  }
  return { type: "object", properties, ...(required.length > 0 && { required }) };
}

function buildOperation(
  doc: Json,
  path: string,
  method: (typeof HTTP_METHODS)[number],
  item: Json,
  op: Json,
): ContractOperation {
  const operationId =
    typeof op.operationId === "string"
      ? op.operationId
      : fail(`${method} ${path} has no operationId`);

  // Operation-level parameters override path-level ones with the same name and location.
  const byKey = new Map<string, Json>();
  for (const raw of [...asArray(item.parameters), ...asArray(op.parameters)]) {
    const param = deref(doc, raw);
    if (param.in === "cookie" || param.schema === undefined) {
      fail(`${operationId}: only schema-based path, query and header parameters are supported`);
    }
    byKey.set(`${String(param.in)}:${String(param.name)}`, param);
  }
  const params = [...byKey.values()];
  const inLocation = (location: string) => params.filter((p) => p.in === location);

  const schema: RouteSchema = {};
  const pathSchema = objectSchema(inLocation("path"), true);
  const querySchema = objectSchema(inLocation("query"), true);
  // Header presence is left to handlers: the contract gives missing headers their own
  // status codes (e.g. a missing If-Match is 428 if-match-required, not 400).
  const headerSchema = objectSchema(inLocation("header"), false);
  if (pathSchema) schema.params = pathSchema;
  if (querySchema) schema.querystring = querySchema;
  if (headerSchema) schema.headers = headerSchema;

  let requestBody: ContractOperation["requestBody"];
  if (op.requestBody !== undefined) {
    const body = deref(doc, op.requestBody);
    const content = isObject(body.content)
      ? body.content
      : fail(`${operationId}: body has no content`);
    const jsonContent: Record<string, { schema: SchemaObject }> = {};
    for (const [mediaType, media] of Object.entries(content)) {
      if (isJsonMediaType(mediaType) && isObject(media) && media.schema !== undefined) {
        jsonContent[mediaType] = { schema: toAjvSchema(media.schema) as SchemaObject };
      }
    }
    if (Object.keys(jsonContent).length > 0) schema.body = { content: jsonContent };
    requestBody = { required: body.required === true, mediaTypes: Object.keys(content) };
  }

  return {
    operationId,
    method: method.toUpperCase() as HttpMethod,
    url: path.replace(/\{([^}]+)\}/g, ":$1"),
    schema,
    ...(requestBody && { requestBody }),
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function load(path: string): Promise<Contract> {
  const doc: unknown = parse(await readFile(path, "utf8"));
  if (!isObject(doc) || !isObject(doc.paths)) fail(`${path} has no paths`);
  const schemas =
    isObject(doc.components) && isObject(doc.components.schemas) ? doc.components.schemas : {};

  const keywords = [...OPENAPI_KEYWORDS, ...collectExtensionKeywords(doc, new Set())];
  const components: SchemaObject = { $id: COMPONENTS_ID, $defs: toAjvSchema(schemas) };
  const bodyAjv = createAjv({ coerceTypes: false }, components, keywords);
  const otherAjv = createAjv({ coerceTypes: "array" }, components, keywords);
  // Compile every component now, so a contract Ajv cannot handle fails at start-up.
  for (const ajv of [bodyAjv, otherAjv]) {
    for (const name of Object.keys(schemas)) ajv.getSchema(`${COMPONENTS_ID}#/$defs/${name}`);
  }

  const operations: ContractOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    if (!isObject(item)) continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (isObject(op)) operations.push(buildOperation(doc, path, method, item, op));
    }
  }

  return {
    operations,
    compileValidator: ({ schema, httpPart }) =>
      (httpPart === "body" ? bodyAjv : otherAjv).compile(schema as SchemaObject),
  };
}

const cache = new Map<string, Promise<Contract>>();

/** Parses the OpenAPI document once per path and prepares its routes and validators. */
export function loadContract(path: string): Promise<Contract> {
  let contract = cache.get(path);
  if (contract === undefined) {
    contract = load(path);
    cache.set(path, contract);
    contract.catch(() => cache.delete(path));
  }
  return contract;
}
