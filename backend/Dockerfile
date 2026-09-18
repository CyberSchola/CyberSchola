# CyberSchola API image.
#
# Two stages: the first installs every dependency and compiles, the second
# carries only the compiled output and production dependencies, and runs as the
# unprivileged `node` user.
#
# Dependencies come from the lockfile and nothing else: `--frozen-lockfile`
# refuses to resolve anything the lockfile does not already pin, and no package
# is allowed to run an install script (`onlyBuiltDependencies` is empty in
# package.json), so installing cannot execute code from the registry.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# The Supabase root CA the database connection pins. See data-source.ts.
COPY --chown=node:node certs ./certs

USER node
EXPOSE 3000
CMD ["node", "dist/main"]
