import { Injectable, Logger } from '@nestjs/common';
import { N8nNotificationService } from './n8n-notification.service';
import { N8nPayloadDto } from './dto/n8n-payload.dto';
import { UsersService } from '../../users/users.service';

@Injectable()
export class N8nIntegrationService {
  private readonly logger = new Logger(N8nIntegrationService.name);

  constructor(
    private readonly n8nNotificationService: N8nNotificationService,
    private readonly usersService: UsersService,
  ) {}

  async handleCoinflowWebhook(event: { payload: any; webhookId: string }) {
    try {
      const { payload, webhookId } = event;

      // Coinflow webhook structure: payload.data contains the transaction info
      const data = payload.data || {};
      const webhookInfo = data.webhookInfo || {};
      const eventType = payload.eventType || 'unknown';
      const category = payload.category || 'unknown';
      
      // Determine status based on official Coinflow event types
      // Reference: https://docs.coinflow.cash/guides/checkout/checkout-webhooks
      const eventTypeLower = eventType.toLowerCase();
      const isFailedEvent = 
        eventTypeLower.includes('declined') ||           // "Card Payment Declined"
        eventTypeLower.includes('fraud') ||              // "Card Payment Suspected Fraud"
        eventTypeLower.includes('failed') ||             // "ACH Failed", "PIX Failed", "Subscription Failure"
        eventTypeLower.includes('pending review') ||     // "Payment Pending Review"
        eventTypeLower.includes('chargeback opened') ||  // "Card Payment Chargeback Opened"
        eventTypeLower.includes('chargeback lost') ||    // "Card Payment Chargeback Lost"
        eventTypeLower.includes('returned') ||           // "ACH Returned"
        eventTypeLower.includes('expiration') ||         // "PIX Expiration", "Payment Expiration"
        eventTypeLower.includes('expired') ||            // "Subscription Expired"
        eventTypeLower.includes('canceled') ||           // "Subscription Canceled"
        eventTypeLower.includes('concluded');            // "Subscription Concluded"
      
      const status = isFailedEvent ? 'failed' : 'success';
      
      // Query database for user name, email, and state
      let customerName = '';
      let customerEmail = '';
      let customerState = '';
      const userId = webhookInfo.user_id || '';
      
      if (userId) {
        try {
          const user = await this.usersService.findOne(userId);
          if (user) {
            customerName = user.name || '';
            customerEmail = user.email || '';
            customerState = user.state || '';
          }
        } catch (error) {
          this.logger.warn(`Failed to fetch user data for userId ${userId}`, error);
        }
      }
      
      // Extract specific fields from Coinflow payload
      const transaction: any = {
        transactionId: data.id || '',
        blockchainTransactionId: data.signature || '',
        amount: data.total?.cents ? data.total.cents / 100 : 0,
        paymentMethod: data.paymentMethod || '',
      };

      // Only include decline fields if they have values
      if (data.declineCode) {
        transaction.declineCode = data.declineCode;
      }
      if (data.declineDescription) {
        transaction.declineDescription = data.declineDescription;
      }

      const error = this.extractError(data);
      if (error) {
        transaction.error = error;
      }

      const n8nPayload: N8nPayloadDto = {
        eventType,
        category,
        status,
        event: `${category}_${eventType}`,
        customer: {
          userId: userId,
          name: customerName,
          email: customerEmail,
          state: customerState,
        },
        transaction,
        timestamp: payload.created || new Date().toISOString(),
        webhookId,
      };

      // Send to n8n (non-blocking)
      await this.n8nNotificationService.sendToN8n(n8nPayload);
    } catch (error) {
      this.logger.error(
        'Error processing Coinflow webhook for n8n',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  private extractError(data: any): { message: string; details: any } | undefined {
    if (data.error) {
      return {
        message: data.error,
        details: data.errorData || data.errorDetails || null,
      };
    }
    return undefined;
  }
}
