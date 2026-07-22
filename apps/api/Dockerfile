FROM node:20-bookworm-slim AS build

ENV NODE_ENV=production

WORKDIR /app

COPY . .

RUN cd apps/api \
    && npm ci \
    && npx prisma generate \
    && npm run build \
    && npm prune --omit=dev

WORKDIR /app/apps/api

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app/apps/api

COPY --from=build --chown=node:node /app/apps/api/package.json /app/apps/api/package-lock.json ./
COPY --from=build --chown=node:node /app/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./prisma

USER node
EXPOSE 8000

CMD ["node", "dist/server.js"]
