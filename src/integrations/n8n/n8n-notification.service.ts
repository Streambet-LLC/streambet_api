import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { N8nPayloadDto } from './dto/n8n-payload.dto';

@Injectable()
export class N8nNotificationService {
  private readonly logger = new Logger(N8nNotificationService.name);
  private readonly webhookUrl: string;
  private readonly webhookSecret: string;
  private readonly enabled: boolean;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.webhookUrl = this.configService.get<string>('coinflow.n8n.webhookUrl', '');
    this.webhookSecret = this.configService.get<string>('coinflow.n8n.webhookSecret', '');
    this.enabled = this.configService.get<boolean>('coinflow.n8n.enabled', false);
    this.maxRetries = this.configService.get<number>('coinflow.n8n.retries', 3);
    this.retryDelayMs = this.configService.get<number>('coinflow.n8n.retryDelayMs', 1000);
    this.timeoutMs = this.configService.get<number>('coinflow.n8n.timeoutMs', 5000);
  }

  async sendToN8n(payload: N8nPayloadDto): Promise<void> {
    if (!this.enabled) {
      this.logger.debug('n8n notifications disabled');
      return;
    }

    if (!this.webhookUrl) {
      this.logger.warn('n8n webhook URL not configured');
      return;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const delay = attempt > 0 ? this.retryDelayMs * Math.pow(2, attempt - 1) : 0;
        
        if (delay > 0) {
          this.logger.debug(`Retry attempt ${attempt} after ${delay}ms delay`);
          await this.sleep(delay);
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        // Add authentication header if secret is configured
        if (this.webhookSecret) {
          headers['X-Webhook-Secret'] = this.webhookSecret;
        }

        await axios.post(this.webhookUrl, payload, {
          timeout: this.timeoutMs,
          headers,
        });

        this.logger.log(`Successfully sent webhook to n8n (attempt ${attempt + 1})`);
        return;
      } catch (error) {
        lastError = error as Error;
        
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          const status = axiosError.response?.status;

          // Don't retry on 4xx errors (client errors)
          if (status && status >= 400 && status < 500) {
            this.logger.error(
              `n8n webhook failed with client error ${status}, not retrying`,
              axiosError.message,
            );
            return;
          }

          this.logger.warn(
            `n8n webhook attempt ${attempt + 1} failed: ${axiosError.message}`,
          );
        } else {
          this.logger.warn(
            `n8n webhook attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }

        // If this was the last attempt, log final error
        if (attempt === this.maxRetries) {
          this.logger.error(
            `n8n webhook failed after ${this.maxRetries + 1} attempts`,
            lastError?.stack,
          );
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
