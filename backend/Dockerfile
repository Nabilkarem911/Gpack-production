FROM node:18-alpine

WORKDIR /app

# poppler-utils provides `pdftoppm` — used to generate real image thumbnails
# from the first page of uploaded PDF design files.
RUN apk add --no-cache poppler-utils

COPY package.json package-lock.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
