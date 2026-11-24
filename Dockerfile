ARG NODE_IMAGE=node:24-alpine
ARG NGINX_IMAGE=nginx:1.31.8-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --replace-registry-host=always --registry=https://registry.npmjs.org --no-fund --no-audit
COPY . .
ENV VITE_BACKEND_URL=""
RUN npm run typecheck && node build.mjs && mv prefix-dist legacy-dist/twilightcup \
    && find legacy-dist -type d -exec chmod 755 {} + \
    && find legacy-dist -type f -exec chmod 644 {} +

FROM ${NGINX_IMAGE}
ARG REVISION
LABEL org.opencontainers.image.revision=$REVISION
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/legacy-dist/ /srv/site/
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
