FROM node:22-trixie-slim@sha256:154ba2f4d6fec323d28e4f4bb86bba4677f1223391a1979cf521304e03a98dfa AS build

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

FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f AS patched-openssl

RUN apt-get update \
    && apt-get install -y --no-install-recommends libssl3t64 \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libssl3t64)" ge '3.5.7-1~deb13u3' \
    && mkdir -p /var/lib/dpkg/status.d \
    && dpkg-query --status libssl3t64 > /var/lib/dpkg/status.d/libssl3t64 \
    && cp /var/lib/dpkg/info/libssl3t64:amd64.md5sums /var/lib/dpkg/status.d/libssl3t64.md5sums \
    && rm -rf /var/lib/apt/lists/*

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:ec2313763dd43931543bd03830466e0c409ce73a487e8d46f10db72d3b816c1c AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app/apps/web

COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/libcrypto.so.3
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/libssl.so.3
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/engines-3 /usr/lib/x86_64-linux-gnu/engines-3
COPY --from=patched-openssl /usr/lib/x86_64-linux-gnu/ossl-modules /usr/lib/x86_64-linux-gnu/ossl-modules
COPY --from=patched-openssl /var/lib/dpkg/status.d/libssl3t64 /var/lib/dpkg/status.d/libssl3t64
COPY --from=patched-openssl /var/lib/dpkg/status.d/libssl3t64.md5sums /var/lib/dpkg/status.d/libssl3t64.md5sums
COPY --from=build --chown=node:node /app/apps/web/package.json /app/apps/web/package-lock.json ./
COPY --from=build --chown=node:node /app/apps/web/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/web/.next ./.next
COPY --from=build --chown=node:node /app/apps/web/public ./public

USER nonroot
EXPOSE 3000

CMD ["node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
