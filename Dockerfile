# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM node:24.21.0-bookworm-slim AS build
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
RUN pnpm --filter @surveyjs-studio/server deploy --prod /out/server
# The docs route reads reference.html next to the contract package's openapi.yaml; the build fails
# when that folder is not found (API_DOCS=true would answer 404 otherwise).
RUN openapi="$(find /out/server/node_modules/@surveyjs-studio/contract/ -maxdepth 1 -name openapi.yaml)" \
    && test -n "$openapi" \
    && contract="$(dirname "$openapi")" \
    && mkdir -p "$contract/dist" \
    && cp contract/dist/reference.html "$contract/dist/reference.html" \
    && rm -rf web/dist/.vite
# The runtime stages may run on another architecture than this one: no native add-on may be in the output.
RUN test -z "$(find /out/server -name '*.node')"

FROM node:24.21.0-bookworm-slim AS app
# Links the package in ghcr.io to the repository, so it takes the repository's access rules.
LABEL org.opencontainers.image.source="https://github.com/surveyjs/surveyjs-studio"
COPY --from=build /out/server /app/server
COPY --from=build /src/web/dist /app/web

# The free self-hosted image (mode 2b): build it with --target self-hosted.
FROM app AS self-hosted
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 WEB_ROOT=/app/web \
    APP_EDITION=self-hosted APP_SHELL=self-hosted \
    STORAGE_PROVIDER=sqlite FILE_STORE=local AUTH_METHODS=password USER_DIRECTORY=local \
    SQLITE_PATH=/data/surveyjs-studio.db FILES_PATH=/data/files SESSION_SECRET_FILE=/data/session-secret \
    PUBLIC_BASE_URL=http://localhost:8080
ARG SURVEYJS_IMAGE_LICENSE_KEY=
ENV SURVEYJS_IMAGE_LICENSE_KEY=$SURVEYJS_IMAGE_LICENSE_KEY
ARG VERSION=dev
LABEL org.opencontainers.image.title="SurveyJS Studio" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.description="SurveyJS Studio, self-hosted: create, host and analyze surveys on your own server." \
      org.opencontainers.image.licenses="MIT"
RUN printf '%s\n' '#!/bin/sh' 'cd /app/server && exec node --import tsx src/cli/surveyjs-studio.ts "$@"' > /usr/local/bin/surveyjs-studio \
    && chmod 755 /usr/local/bin/surveyjs-studio
# A new named volume inherits this owner.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
WORKDIR /app/server
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]

# The hosted image (studio.surveyjs.io): keep this stage last, so a plain `docker build .` builds it.
FROM app AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_ROOT=/app/web
USER node
WORKDIR /app/server
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/main.ts"]
