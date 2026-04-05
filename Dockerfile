FROM node:20-alpine
WORKDIR /app

# bağımlılıkları önce kopyala (cache katmanı)
COPY package.json ./

# package-lock.json varsa kullan, yoksa npm install'a düş
RUN npm install --omit=dev --prefer-offline || npm install --omit=dev

# uygulama kodunu kopyala
COPY . .

EXPOSE 4000
CMD ["node", "server.js"]
