FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

# Production image
FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Install AWS CLI for Parameter Store access in ECS
RUN apk add --no-cache \
    python3 \
    py3-pip \
    && pip3 install --upgrade pip \
    && pip3 install --no-cache-dir \
    awscli

ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main"] 