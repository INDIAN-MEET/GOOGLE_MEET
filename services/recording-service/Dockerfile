FROM node:20-bookworm-slim
WORKDIR /app

# STEP 1: ffmpeg (conversion) + openssl (Prisma engine). /recordings must belong to "node"
# because the container runs as that user and the named volume copies this owner.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg openssl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /recordings \
    && chown node:node /recordings

# STEP 2: install, generate the Prisma client, compile TypeScript to dist/
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate
COPY tsconfig.json server.ts ./
COPY src ./src
RUN npm run build

EXPOSE 4007
USER node

# STEP 3: apply migrations, then start (HTTP + worker run in the same process)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
