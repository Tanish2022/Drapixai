FROM node:22-bookworm-slim AS build

ENV NODE_ENV=production

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY . .

RUN cd apps/api \
    && npm ci --include=dev \
    && npx prisma generate \
    && npm run build \
    && npm prune --omit=dev

WORKDIR /app/apps/api

FROM debian:bookworm-slim AS patched-openssl

RUN apt-get update \
    && apt-get install -y --no-install-recommends libssl3 \
    && mkdir -p /var/lib/dpkg/status.d \
    && dpkg-query --status libssl3 > /var/lib/dpkg/status.d/libssl3 \
    && cp /var/lib/dpkg/info/libssl3:amd64.md5sums /var/lib/dpkg/status.d/libssl3.md5sums \
    && rm -rf /var/lib/apt/lists/*

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime

ENV NODE_ENV=production
WORKDIR /app/apps/api

COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/libcrypto.so.3
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/libssl.so.3
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/engines-3 /usr/lib/x86_64-linux-gnu/engines-3
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/ossl-modules /usr/lib/x86_64-linux-gnu/ossl-modules
COPY --from=patched-openssl /var/lib/dpkg/status.d/libssl3 /var/lib/dpkg/status.d/libssl3
COPY --from=patched-openssl /var/lib/dpkg/status.d/libssl3.md5sums /var/lib/dpkg/status.d/libssl3.md5sums
COPY --from=build --chown=node:node /app/apps/api/package.json /app/apps/api/package-lock.json ./
COPY --from=build --chown=node:node /app/apps/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/prisma ./prisma

USER nonroot
EXPOSE 8000

CMD ["dist/bootstrap.js"]
