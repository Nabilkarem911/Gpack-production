# Stage 1: Minify JS files
FROM node:alpine AS builder
WORKDIR /build
RUN npm install -g terser@5
COPY ./frontend /build/frontend
RUN find /build/frontend/js -name "*.js" -type f | while read f; do \
      terser --compress --mangle --output "$f" "$f" || true; \
    done

# Stage 2: nginx serving minified files
FROM nginx:alpine
COPY --from=builder /build/frontend/ /usr/share/nginx/html/
COPY ./nginx/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
