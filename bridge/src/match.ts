// The old routes matched without Fastify: the same rules the router applies (app.ts routerOptions;
// routes.ts `oldRoute`), for code that holds a method and a path and needs the mapping entry, e.g.
// the replay. Both prefixes of the entry's controller, any letter case, one trailing slash or
// none, `:id` as one non-empty segment. `undefined` is a request the bridge forwards.
import { ACTIONS, type ActionEntry } from "./mapping.js";
import { PREFIXES } from "./routes.js";

interface Route {
  entry: ActionEntry;
  methods: ReadonlySet<string>;
  pattern: RegExp;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A trailing `:id` is one segment; the router also lets it be empty when the path ends in `//`
// (`.../clone//`), which is what `[^/]*` after the trailing-slash strip accepts.
function patternOf(url: string): RegExp {
  const source = url
    .toLowerCase()
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "[^/]*" : escape(segment)))
    .join("/");
  return new RegExp(`^${source}$`);
}

const ROUTES: readonly Route[] = ACTIONS.flatMap((entry) =>
  PREFIXES[entry.controller].flatMap((prefix) =>
    entry.paths.map((path) => ({
      entry,
      methods: new Set<string>(entry.methods),
      pattern: patternOf(path === "" ? prefix : `${prefix}/${path}`),
    })),
  ),
);

/** The entry that answers `method` and `path` (a query, if given, is ignored), else `undefined`. */
export function matchAction(method: string, path: string): ActionEntry | undefined {
  const query = path.indexOf("?");
  let normal = (query < 0 ? path : path.slice(0, query)).toLowerCase();
  if (normal.length > 1 && normal.endsWith("/")) normal = normal.slice(0, -1);
  const verb = method.toUpperCase();
  return ROUTES.find((route) => route.methods.has(verb) && route.pattern.test(normal))?.entry;
}
