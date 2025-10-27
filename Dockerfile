FROM node:22-alpine

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++ linux-headers

RUN mkdir /app
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install dependencies with legacy peer deps and specific flags for SWC
RUN npm install --legacy-peer-deps --ignore-scripts

# Run post-install scripts separately
RUN npm rebuild

# Copy application code
COPY . .

# Install PM2 globally
RUN npm install -g pm2

# Build the application
RUN npm run build

CMD ["pm2-runtime", "dist/src/main.js"]
