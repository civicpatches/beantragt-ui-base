FROM node:22-alpine AS builder

ARG BUILDTIME=unset
ARG VERSION=unset
ARG REVISION=unset

ENV NODE_ENV=production \
    NUXT_PUBLIC_APP_VERSION=${VERSION} \
    NUXT_PUBLIC_BUILD_TIME=${BUILDTIME} \
    NUXT_PUBLIC_GIT_SHA=${REVISION}

# Theme of the installation (README "Theme of the installation"): read by nuxt.config.ts at build time only, so it is a
# build argument; empty means today's look. A value set on the running container has no effect.
ARG NUXT_UI_THEME=
ENV NUXT_UI_THEME=${NUXT_UI_THEME}

WORKDIR /build

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

ENV NUXT_BUILD_SCOPE=casework NITRO_OUTPUT_DIR=.output

COPY . .
RUN ln -s .nuxt-casework .nuxt
RUN pnpm install --frozen-lockfile --prod=false
RUN pnpm run build \
    && rm -rf .nuxt/cache

FROM node:22-alpine

# The runtime only uses Node (CMD below; the base image's docker-entrypoint.sh just execs it).
# npm, npx, corepack and yarn of the base image are never used here, so they leave the image (npm carries reported findings).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /opt/yarn-v* /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app

ENV HOST=0.0.0.0 \
    PORT=3000 \
    NODE_ENV=production \
    NUXT_API_BASE=http://nginx:8080 \
    NUXT_DRUPAL_SERVICE_USER=nuxt_service

COPY --from=builder --chown=node:node /build/scripts/ui-mode/*.mjs /app/scripts/ui-mode/
COPY --from=builder --chown=node:node /build/.output /app/.output

EXPOSE 3000

USER node

CMD ["node", "scripts/ui-mode/start.mjs"]
