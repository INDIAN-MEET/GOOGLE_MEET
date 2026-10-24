FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

COPY tsconfig.json server.ts ./
COPY types ./types
COPY src ./src

RUN npm run build

EXPOSE 4008
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]