# NetSentinel frontend -- built as a static bundle and served by nginx.
# Vite bakes VITE_* env vars in at *build* time, not at container start,
# so they're build args here (see docs/DEPLOYMENT.md). The defaults match
# docker-compose.yml's published ports, i.e. "the browser on your host
# machine talking to the backend's published port" -- not
# container-to-container networking, since the browser runs on the host.
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

ARG VITE_API_BASE_URL=http://localhost:8000
ARG VITE_WS_BASE_URL=ws://localhost:8000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_WS_BASE_URL=${VITE_WS_BASE_URL}

RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -qO- http://localhost:80 >/dev/null 2>&1 || exit 1
