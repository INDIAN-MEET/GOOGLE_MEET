FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

EXPOSE 4008
# Run pending migrations, then start the compiled server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]