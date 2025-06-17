# Streambet Backend

This is the backend for the Streambet platform, a live betting application that combines livestreamed entertainment with real-time wagering using virtual tokens.

## Tech Stack

- NestJS with TypeScript
- PostgreSQL with TypeORM
- Redis for caching
- WebSockets for real-time communication
- JWT for authentication
- Stripe for payments
- Google OAuth for social login

## Getting Started

### Prerequisites

- Node.js (v18+)
- PostgreSQL
- Redis
- Docker (optional, for containerization)

### Environment Setup

Create a `.env.development` file in the root directory with the following variables:

```
# Server
NODE_ENV=development
PORT=3000
CLIENT_URL=http://localhost:3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=streambet_dev

# JWT
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=1d

# Refresh Token
REFRESH_TOKEN_SECRET=your_refresh_token_secret_key
REFRESH_TOKEN_EXPIRES_IN=30d

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Installation

```bash
# Install dependencies
npm install

# Run the development server
npm run start:dev
```

### Docker Setup

To run the application using Docker:

```bash
# Build and start containers
docker-compose up -d

# Stop containers
docker-compose down
```

## API Documentation

The API documentation is automatically generated using Swagger/OpenAPI.

After starting the application, visit:

```
http://localhost:3000/api/docs
```

This interactive documentation provides:

- Detailed endpoint descriptions
- Request/response schemas
- Ability to test endpoints directly from the browser
- Authentication support

## Database Management

### Setup

Before running the application, make sure you have PostgreSQL running with a database created matching your configuration:

```sql
CREATE DATABASE streambet_dev;
```

### Migrations

Database migrations are handled using TypeORM. Here are the main commands:

```bash
# Generate a migration from entity changes
npm run migration:generate --name=YourMigrationName

# Create an empty migration file
npm run migration:create --name=YourMigrationName

# Run pending migrations
npm run migration:run

# Revert the most recent migration
npm run migration:revert

# Generate and run initial migration (first-time setup)
npm run db:sync
```

See `src/database/README.md` for more detailed instructions on working with migrations.

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login with email and password
- `POST /api/auth/refresh` - Refresh access token using refresh token
- `POST /api/auth/logout` - Logout and invalidate refresh token
- `GET /api/auth/me` - Get current user profile
- `GET /api/auth/google` - Google OAuth login
- `GET /api/auth/google/callback` - Google OAuth callback

## Authentication & Refresh Tokens

The application uses JWT (JSON Web Tokens) for authentication with JWT refresh token support for enhanced security.

### Token Types

1. **Access Token**: Short-lived JWT token (default: 7 days) used for API authentication
2. **Refresh Token**: Long-lived JWT token (default: 30 days) used to obtain new access tokens

### Authentication Flow

1. **Login/Register**: User receives both access token and refresh token (both are JWT tokens)
2. **API Requests**: Include access token in Authorization header: `Bearer <access_token>`
3. **Token Refresh**: When access token expires, use refresh token to get new tokens
4. **Logout**: Invalidates refresh token on server side

### Security Features

- **Separate Secrets**: Access tokens and refresh tokens use different JWT secrets
- **Database Validation**: Refresh tokens are validated against the database to prevent reuse
- **Automatic Expiration**: Expired refresh tokens are automatically cleaned up
- **Token Rotation**: Each refresh operation generates new access and refresh tokens
- **Guard Protection**: Refresh token endpoint is protected by RefreshTokenGuard for enhanced security

### Guard Architecture

The refresh token endpoint uses a dedicated `RefreshTokenGuard` that:

1. **Extracts Token**: Gets the refresh token from the request body
2. **JWT Verification**: Validates the JWT refresh token signature and expiration
3. **User Validation**: Ensures the user exists and is active
4. **Database Check**: Verifies the token matches the one stored in the database
5. **Expiration Check**: Validates the database expiration timestamp
6. **User Injection**: Attaches the validated user to the request for use in the controller

This approach provides multiple layers of security and ensures that only valid, non-expired refresh tokens can be used to obtain new access tokens.

### Example Usage

```bash
# Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": "user@example.com", "password": "password123"}'

# Response includes both tokens
{
  "data": {
    "id": "user-id",
    "username": "username",
    "email": "user@example.com",
    "role": "user",
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "abc123def456..."
  },
  "message": "User logged in successfully",
  "statusCode": 200
}

# Use access token for API requests
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Refresh tokens when access token expires
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "abc123def456..."}'

# Logout (invalidates refresh token)
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### Google OAuth

Google OAuth also supports refresh tokens. After successful Google authentication, users receive both access and refresh tokens via the callback URL:

```
http://localhost:8080/auth/google-callback?token=<access_token>&refreshToken=<refresh_token>
```

### Betting

- `GET /api/betting/streams` - Get all active streams
- `GET /api/betting/streams/:id` - Get stream details
- `GET /api/betting/streams/:id/betting-variables` - Get betting options for a stream
- `POST /api/betting/place-bet` - Place a bet
- `DELETE /api/betting/bets/:id` - Cancel a bet
- `GET /api/betting/user-bets` - Get user's betting history

### Wallets

- `GET /api/wallets/balance` - Get user's wallet balance
- `GET /api/wallets/transactions` - Get user's transaction history

### Payments

- `POST /api/payments/create-checkout-session` - Create a Stripe checkout session
- `POST /api/payments/webhook` - Stripe webhook endpoint
- `POST /api/payments/auto-reload` - Set up auto-reload for betting

### Admin

- `POST /api/admin/streams` - Create a new stream
- `PATCH /api/admin/streams/:id/status` - Update stream status
- `POST /api/admin/betting-variables` - Create betting options
- `PATCH /api/admin/betting-variables/:id/lock` - Lock betting
- `POST /api/admin/betting-variables/:id/declare-winner` - Declare a winner
- `GET /api/admin/users` - Get all users
- `PATCH /api/admin/users/:id/wallet` - Adjust user's wallet balance

## WebSocket Events

### Client to Server

- `joinStream` - Join a stream room
- `leaveStream` - Leave a stream room
- `placeBet` - Place a bet in real-time
- `sendChatMessage` - Send a chat message

### Server to Client

- `joinedStream` - Confirmation of joining a stream
- `bettingUpdate` - Updates on betting statistics
- `chatMessage` - New chat message
- `bettingLocked` - Betting has been locked
- `winnerDeclared` - Winner has been declared
- `notification` - User-specific notifications

## CI/CD Pipeline

The application uses GitLab CI/CD for automated testing, building, and deployment to AWS ECS. The pipeline is configured to deploy to different environments based on the branch:

- `dev` branch → Development environment
- `qa` branch → QA environment
- `staging` branch → Staging environment
- `prod` branch → Production environment (manual deployment)

### Pipeline Stages

1. **Validate**: Runs linting to ensure code quality
2. **Test**: Runs unit tests with temporary PostgreSQL and Redis instances
3. **Build**: Builds Docker image and pushes to AWS ECR
4. **Deploy**: Updates ECS task definition and deploys to the corresponding environment

### AWS Integration

The pipeline integrates with AWS services:

- **AWS Parameter Store**: Fetches environment-specific configuration (database credentials, API keys, etc.)
- **AWS ECR**: Stores Docker images for each environment
- **AWS ECS**: Runs the application containers

### Required AWS Resources

Before using the pipeline, ensure the following AWS resources are set up:

1. **ECR Repository**: `streambet-backend`
2. **ECS Clusters**: One for each environment (`streambet-dev`, `streambet-qa`, `streambet-staging`, `streambet-prod`)
3. **ECS Task Definitions**: One for each environment (`streambet-backend-dev`, `streambet-backend-qa`, etc.)
4. **ECS Services**: One for each environment

### Required GitLab Variables

Set the following variables in GitLab CI/CD settings:

- `AWS_ACCESS_KEY_ID`: AWS access key with necessary permissions
- `AWS_SECRET_ACCESS_KEY`: AWS secret key
- `AWS_ACCOUNT_ID`: Your AWS account ID

### Parameter Store Structure

Parameters should be organized in the Parameter Store with the following path structure:

```
/streambet/dev/DB_HOST
/streambet/dev/DB_PORT
/streambet/dev/DB_USERNAME
...and so on
```

For each environment (dev, qa, staging, prod).

## AWS Infrastructure Setup

The AWS infrastructure is currently set up manually. The following resources are required:

### ECR Repository

- Create a repository named `streambet-backend` to store Docker images

### ECS Clusters

- Create clusters for each environment: `streambet-dev`, `streambet-qa`, `streambet-staging`, `streambet-prod`

### ECS Task Definitions

- Create task definitions for each environment with the following configuration:
  - Family: `streambet-backend-{env}` (e.g., `streambet-backend-dev`)
  - Network mode: `awsvpc`
  - CPU: `256`
  - Memory: `512`
  - Container name: `streambet-backend`
  - Container port: `3000`
  - Environment variables:
    - `NODE_ENV`: environment name (`dev`, `qa`, `staging`, `prod`)
    - `AWS_REGION`: your AWS region

### ECS Services

- Create services for each environment linked to the corresponding task definition and cluster
- Configure networking with appropriate security groups and subnets

### IAM Roles

- Create an execution role for ECS tasks with permissions to pull from ECR and access CloudWatch logs
- Create a task role with permissions to access AWS Parameter Store

### Parameter Store

- Create parameters for each environment (see Parameter Store Structure above)
