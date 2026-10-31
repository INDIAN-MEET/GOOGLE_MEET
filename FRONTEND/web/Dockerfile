# =====================================================================
# FRONTEND/web/Dockerfile
# STEP 1 build static files with Node
# STEP 2 serve them with nginx (no Node at runtime)
# =====================================================================

# STEP 1 — build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_* are compile-time values → build args
ARG VITE_API_URL=http://localhost:4000
ARG VITE_SIGNALING_URL=http://localhost:4004
ARG VITE_SFU_URL=http://localhost:4004
ARG VITE_TURN_URL=turn:localhost:3478
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SIGNALING_URL=$VITE_SIGNALING_URL \
    VITE_SFU_URL=$VITE_SFU_URL \
    VITE_TURN_URL=$VITE_TURN_URL
RUN npm run build

# STEP 2 — runtime stage
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

