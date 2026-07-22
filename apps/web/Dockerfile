FROM node:20-bookworm-slim AS build

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY . .

RUN cd apps/web \
    && npm ci --include=dev \
    && npm run build \
    && npm prune --omit=dev

WORKDIR /app/apps/web

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app/apps/web

COPY --from=build --chown=node:node /app/apps/web/package.json /app/apps/web/package-lock.json ./
COPY --from=build --chown=node:node /app/apps/web/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/web/.next ./.next
COPY --from=build --chown=node:node /app/apps/web/public ./public

USER node
EXPOSE 3000

CMD ["npm", "start", "--", "-H", "0.0.0.0", "-p", "3000"]
