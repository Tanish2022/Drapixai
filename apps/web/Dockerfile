FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

WORKDIR /app

COPY . .

RUN cd apps/web \
    && npm ci \
    && npm run build \
    && npm prune --omit=dev

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["npm", "start", "--", "-H", "0.0.0.0", "-p", "3000"]

