FROM node:22

RUN mkdir /app
WORKDIR /app
COPY . .

RUN npm install -g pm2
RUN npm install -g yarn@1.22.18 --force

RUN npm install
RUN npm run build

CMD ["pm2-docker", "npm run start:prod"]
