FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY src ./src
COPY server.ts ./
COPY types ./types
RUN npx prisma generate
RUN npm run build
EXPOSE 4003
CMD ["node", "dist/server.js"]