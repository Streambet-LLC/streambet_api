export interface N8nPayloadDto {
  // Coinflow event details
  eventType: string; // 'Settled', 'Failed', 'Pending', etc.
  category: string; // 'Purchase' or 'Withdrawal'
  status: string; // 'success' or 'failed'
  event: string; // Combined: 'Purchase_Settled', 'Purchase_Failed', etc.

  // Coinflow customer data
  customer: {
    userId: string; // Coinflow user_id from webhookInfo
    name: string;
    email: string;
    state: string;
  };

  // Transaction details
  transaction: {
    transactionId: string; // Coinflow payment ID
    blockchainTransactionId?: string;
    amount?: number;
    paymentMethod?: string;
    declineCode?: string; // Decline code for failed card payments
    declineDescription?: string; // Human-readable decline reason
    error?: {
      message: string;
      details: any;
    };
  };

  // Metadata
  timestamp: string;
  webhookId: string;
}
