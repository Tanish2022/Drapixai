FROM node:22-bookworm-slim AS build

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

FROM debian:bookworm-slim AS patched-openssl

RUN apt-get update \
    && apt-get install -y --no-install-recommends libssl3 \
    && mkdir -p /var/lib/dpkg/status.d \
    && dpkg-query --status libssl3 > /var/lib/dpkg/status.d/libssl3 \
    && cp /var/lib/dpkg/info/libssl3:amd64.md5sums /var/lib/dpkg/status.d/libssl3.md5sums \
    && rm -rf /var/lib/apt/lists/*

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app/apps/web

COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/libcrypto.so.3
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/libssl.so.3
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/engines-3 /usr/lib/x86_64-linux-gnu/engines-3
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/ossl-modules /usr/lib/x86_64-linux-gnu/ossl-modules
COPY --from=patched-openssl /var/lib/dpkg/status.d/libssl3 /var/lib/dpkg/status.d/libssl3
COPY --from=patched-openssl /var/lib/dpkg/status.d/libssl3.md5sums /var/lib/dpkg/status.d/libssl3.md5sums
COPY --from=build --chown=node:node /app/apps/web/package.json /app/apps/web/package-lock.json ./
COPY --from=build --chown=node:node /app/apps/web/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/web/.next ./.next
COPY --from=build --chown=node:node /app/apps/web/public ./public

USER nonroot
EXPOSE 3000

CMD ["node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
