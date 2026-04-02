FROM node:20-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

COPY . .

RUN cd apps/api \
    && npm ci \
    && npx prisma generate \
    && npm run build \
    && npm prune --omit=dev

WORKDIR /app/apps/api

EXPOSE 8000

CMD ["node", "dist/server.js"]

