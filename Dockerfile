FROM node:22

RUN mkdir /app
WORKDIR /app
COPY . .

RUN npm install -g pm2

RUN npm ci
RUN npm run build

CMD ["pm2-docker", "npm run start:prod"]
