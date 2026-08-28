FROM node:18-alpine

WORKDIR /app

# poppler-utils provides `pdftoppm` — used to generate real image thumbnails
# from the first page of uploaded PDF design files.
RUN apk add --no-cache poppler-utils

COPY package.json package-lock.json ./

RUN npm install --omit=dev

# Auto-invalidate build cache on every build using the current timestamp.
# This guarantees the next COPY . . always picks up the latest source code,
# so you never need to manually bump CACHEBUST in Dokploy env.
ARG CACHEBUST
RUN echo "Build cache key: ${CACHEBUST:-$(date +%s)}" > /tmp/cachebust

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
