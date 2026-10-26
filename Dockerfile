# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /src

# Manifests first, so the dependency layer is reused until a manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY contract/package.json contract/
COPY server/package.json server/
COPY web/package.json web/
COPY conformance-tests/package.json conformance-tests/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
RUN pnpm --filter @my-surveys/server deploy --prod /out/server
# The docs route reads reference.html next to the contract package's openapi.yaml; the build fails
# when that folder is not found (API_DOCS=true would answer 404 otherwise).
RUN openapi="$(find /out/server/node_modules/@my-surveys/contract/ -maxdepth 1 -name openapi.yaml)" \
    && test -n "$openapi" \
    && contract="$(dirname "$openapi")" \
    && mkdir -p "$contract/dist" \
    && cp contract/dist/reference.html "$contract/dist/reference.html" \
    && rm -rf web/dist/.vite

FROM node:24.21.0-bookworm-slim AS runtime
# Links the package in ghcr.io to the repository, so it takes the repository's access rules.
LABEL org.opencontainers.image.source="https://github.com/surveyjs/my-surveys"
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_ROOT=/app/web
COPY --from=build /out/server /app/server
COPY --from=build /src/web/dist /app/web
USER node
WORKDIR /app/server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
