FROM node:18-alpine

WORKDIR /app

# poppler-utils provides `pdftoppm` — used to generate real image thumbnails
# from the first page of uploaded PDF design files.
RUN apk add --no-cache poppler-utils

COPY package.json package-lock.json ./

RUN npm install --omit=dev

# CACHEBUST is passed at build time to force a re-copy of source files.
# Bump the value in Dokploy env to invalidate the build cache when needed.
ARG CACHEBUST=1
RUN echo "CACHEBUST=$CACHEBUST"

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
