# n8n Integration for Coinflow Transaction Monitoring

## Overview

This module integrates the StreamBet API with n8n (workflow automation platform) to provide real-time monitoring of Coinflow transactions. When a Coinflow webhook is received, this integration enriches the transaction data with user information from the database and forwards it to n8n, which then posts formatted notifications to Slack.

## Architecture

```
Coinflow Webhook → WebhookService → N8nIntegrationService → N8nNotificationService → n8n → Slack
                                            ↓
                                       UsersService (DB Query)
```

## Components

### 1. N8nPayloadDto (`dto/n8n-payload.dto.ts`)
Defines the structure of data sent to n8n:

```typescript
{
  eventType: string;      // 'Settled', 'Failed', 'Pending'
  category: string;       // 'Purchase', 'Withdrawal'
  status: string;         // 'success', 'failed'
  event: string;          // Combined: 'Purchase_Settled'
  customer: {
    userId: string;       // From Coinflow webhookInfo
    name: string;         // From database
    email: string;        // From database
    state: string;        // From database
  };
  transaction: {
    transactionId: string;
    blockchainTransactionId?: string;
    amount?: number;
    paymentMethod?: string;
    error?: {...};
  };
  timestamp: string;
  webhookId: string;      // Internal webhook record ID
}
```

### 2. N8nIntegrationService (`n8n-integration.service.ts`)
**Purpose**: Transforms Coinflow webhook data and enriches it with user information.

**Key Methods**:
- `handleCoinflowWebhook(event)`: Main entry point for processing webhooks
- `extractError(data)`: Extracts error information from failed transactions

**Data Enrichment Flow**:
1. Extracts event metadata from Coinflow payload (`eventType`, `category`)
2. Determines transaction status (success/failed)
3. Queries database for user information using `userId`
4. Combines Coinflow data with user data
5. Sends enriched payload to n8n

**Error Handling**:
- Gracefully handles missing user data (returns empty strings)
- Logs warnings when user lookup fails
- Never throws errors that would break webhook processing

### 3. N8nNotificationService (`n8n-notification.service.ts`)
**Purpose**: Handles HTTP communication with the n8n webhook endpoint.

**Features**:
- **Authentication**: Adds `X-Webhook-Secret` header for security
- **Retry Logic**: Exponential backoff (1s, 2s, 4s) on failures
- **Smart Error Handling**: 
  - Retries on 5xx errors (server issues)
  - Does NOT retry on 4xx errors (client errors)
- **Timeout Protection**: 5-second timeout prevents hanging requests
- **Comprehensive Logging**: Tracks all attempts and failures

**Configuration** (from environment variables):
```typescript
{
  webhookUrl: string;        // n8n webhook endpoint
  webhookSecret: string;     // Authentication token
  enabled: boolean;          // Toggle integration on/off
  maxRetries: number;        // Default: 3
  retryDelayMs: number;      // Default: 1000ms
  timeoutMs: number;         // Default: 5000ms
}
```

## Configuration

### Environment Variables

Required in `.env` and `docker-compose.yml`:

```bash
# n8n Integration
N8N_WEBHOOK_URL=http://52.15.37.177:5678/webhook/962ad063-c469-4a1b-94b7-5665599df9e0
N8N_WEBHOOK_SECRET=streambet_n8n_webhook_secret_2025_a7b9c3d4e5f6
N8N_ENABLED=true
N8N_RETRIES=3
N8N_RETRY_DELAY_MS=1000
N8N_TIMEOUT_MS=5000
```

### Configuration Module

Configuration is loaded via `src/config/coinflow.config.ts`:

```typescript
n8n: {
  webhookUrl: process.env.N8N_WEBHOOK_URL || '',
  webhookSecret: process.env.N8N_WEBHOOK_SECRET || '',
  enabled: process.env.N8N_ENABLED === 'true',
  retries: Number(process.env.N8N_RETRIES || 3),
  retryDelayMs: Number(process.env.N8N_RETRY_DELAY_MS || 1000),
  timeoutMs: Number(process.env.N8N_TIMEOUT_MS || 5000),
}
```

## Usage

### Module Import

The n8n integration is used by the `WebhookModule`:

```typescript
// webhook.module.ts
import { N8nIntegrationModule } from 'src/integrations/n8n/n8n-integration.module';

@Module({
  imports: [
    N8nIntegrationModule,
    // ... other imports
  ],
})
export class WebhookModule {}
```

### Service Injection

```typescript
// webhook.service.ts
constructor(
  private readonly n8nIntegrationService: N8nIntegrationService,
) {}

async queueCoinflowWebhookEvent(payload: CoinflowWebhookDto) {
  // ... existing webhook processing
  
  // Send to n8n (non-blocking)
  this.n8nIntegrationService.handleCoinflowWebhook({
    payload,
    webhookId: webhook.id,
  }).catch(error => {
    this.logger.error('n8n integration error', error?.stack);
  });
}
```

## n8n Workflow Setup

### 1. Webhook Trigger Node
- **URL**: Your n8n webhook endpoint
- **Authentication Method**: Header Auth
- **Header Name**: `X-Webhook-Secret`
- **Header Value**: Your secret token

### 2. Slack Node
- **Resource**: Message
- **Operation**: Post
- **Channel**: Your target channel (e.g., `coinflow-transactions`)
- **Credential**: Slack Access Token with scopes:
  - `chat:write`
  - `channels:read` or `groups:read`

### 3. Message Template Example

```
{{ $json.body.status === 'failed' ? '❌ FAILED' : '✅ SUCCESS' }} *Purchase - ${{ $json.body.transaction.amount }}*

*Timestamp:* {{ $json.body.timestamp }}
*Customer:* {{ $json.body.customer.name }} ({{ $json.body.customer.state }})
*Email:* {{ $json.body.customer.email }}
*Payment:* {{ $json.body.transaction.paymentMethod }}
*Status:* {{ $json.body.status }}
*Transaction ID:* {{ $json.body.transaction.transactionId }}
*User ID:* {{ $json.body.customer.userId }}
```

## Testing

### Local Testing with cURL

```bash
curl -X POST http://52.15.37.177:5678/webhook/962ad063-c469-4a1b-94b7-5665599df9e0 \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: streambet_n8n_webhook_secret_2025_a7b9c3d4e5f6" \
  -d '{
    "eventType": "Settled",
    "category": "Purchase",
    "status": "success",
    "customer": {
      "userId": "test-user-id",
      "name": "Test User",
      "email": "test@example.com",
      "state": "CA"
    },
    "transaction": {
      "transactionId": "test-tx-123",
      "amount": 10.99,
      "paymentMethod": "VISA"
    },
    "timestamp": "2025-12-06T00:00:00.000Z",
    "webhookId": "webhook-123"
  }'
```

### Checking Logs

```bash
# Check n8n-related logs in Docker
docker compose logs --tail=50 api | grep -i n8n

# Check for errors
docker compose logs --tail=50 api | grep -E "ERROR.*n8n"
```

## Security

### Webhook Authentication
- All requests include `X-Webhook-Secret` header
- Secret token should be rotated regularly
- Keep token secure in environment variables

### Network Security
- n8n EC2 instance has Security Group rules restricting port 5678 access
- Only authorized IPs can reach the webhook endpoint

### Error Information
- Error details from failed transactions are captured but sanitized
- No sensitive data (passwords, full card numbers) is ever transmitted

## Troubleshooting

### n8n Not Receiving Webhooks

1. **Check if integration is enabled**:
   ```bash
   docker compose exec api env | grep N8N_ENABLED
   # Should show: N8N_ENABLED=true
   ```

2. **Verify webhook URL**:
   ```bash
   docker compose exec api env | grep N8N_WEBHOOK_URL
   ```

3. **Check logs for errors**:
   ```bash
   docker compose logs api | grep "n8n integration error"
   ```

### Webhooks Failing

1. **Authentication Issues**: Verify `X-Webhook-Secret` matches in both backend and n8n
2. **Network Issues**: Check Security Group rules on EC2 instance
3. **n8n Down**: Verify n8n service is running: `docker ps` on EC2

### User Data Missing

1. **Check user exists**: Verify `userId` from webhook exists in database
2. **Check logs**: Look for "Failed to fetch user data" warnings
3. **Verify UsersModule**: Ensure `UsersModule` is imported in `N8nIntegrationModule`

## Performance Considerations

### Non-Blocking Execution
The n8n integration runs asynchronously and uses `.catch()` to prevent failures from affecting webhook processing:

```typescript
this.n8nIntegrationService.handleCoinflowWebhook(...)
  .catch(error => {
    // Logged but doesn't throw
  });
```

### Database Queries
- One additional database query per webhook (user lookup)
- Query is fast (indexed by primary key `id`)
- Cached by NestJS if caching is enabled

### Network Overhead
- Single HTTP POST request to n8n
- Timeout: 5 seconds maximum
- Retries add minimal overhead (exponential backoff)

## Related Documentation

- [Coinflow Webhook Documentation](https://docs.coinflow.cash/guides/developer-resources/webhooks)
- [n8n Webhook Documentation](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)
- [Slack API Documentation](https://api.slack.com/messaging/webhooks)

## Support

For issues or questions about this integration:
1. Check logs first: `docker compose logs api | grep -i n8n`
2. Verify configuration: `docker compose exec api env | grep N8N_`
3. Test n8n directly with cURL (see Testing section)
4. Review this README and related documentation
