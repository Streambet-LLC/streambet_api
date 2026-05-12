FROM node:22

RUN mkdir /app
WORKDIR /app
COPY package*.json ./

RUN npm install -g pm2
RUN npm install

COPY . .
RUN npm run build

# Use start:dev in development, start:prod in production
CMD ["npm", "run", "start:dev"]
