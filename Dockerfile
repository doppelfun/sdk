# SDK agent claw for Railway (or any container platform).
# All config via env: DOPPEL_AGENT_API_KEY, OPENROUTER_API_KEY, HUB_URL, SPACE_ID, etc.

FROM node:20-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.14.2 --activate
WORKDIR /app

FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
WORKDIR /app
CMD ["node", "packages/claw/dist/cli.js"]
