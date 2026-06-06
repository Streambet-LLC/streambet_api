import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailLog } from './entities/email-log.entity';
import { EmailsService } from './email.service';

/**
 * Read + resend access to the email audit log. Replaying a log re-sends the
 * exact stored payload through `EmailsService.sendEmailSMTP` (which writes a
 * fresh log row for the new attempt).
 */
@Injectable()
export class EmailLogService {
  constructor(
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
    private readonly emailsService: EmailsService,
  ) {}

  /** All send attempts for an order, newest first. */
  async listForOrder(orderId: string): Promise<EmailLog[]> {
    return this.emailLogRepository.find({
      where: { relatedOrderId: orderId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Recent send attempts across the system (admin overview). */
  async listRecent(opts: { limit?: number; offset?: number } = {}): Promise<{
    data: EmailLog[];
    total: number;
  }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const [data, total] = await this.emailLogRepository.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { data, total };
  }

  /** Re-send a previously-logged email using its stored payload. */
  async resendLog(id: string): Promise<{ message: string }> {
    const log = await this.emailLogRepository.findOne({ where: { id } });
    if (!log) throw new NotFoundException('Email log not found');

    await this.emailsService.sendEmailSMTP(
      {
        toAddress: (log.toAddress || '').split(',').filter(Boolean),
        subject: log.subject ?? '',
        params: (log.params ?? {}) as Record<string, unknown>,
      },
      log.emailType,
    );
    return { message: 'Email resent' };
  }
}
