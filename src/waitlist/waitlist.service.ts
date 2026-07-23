import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailPayloadDto } from '../emails/dto/email.dto';
import { EmailType } from '../enums/email-type.enum';
import { QueueService } from '../queue/queue.service';
import { WaitlistSignup } from './entities/waitlist-signup.entity';

export interface WaitlistSignupDto {
  id: string;
  email: string;
  name: string | null;
  source: string | null;
  createdAt: string;
}

/** Basic email shape check — deliberately permissive, real validation is delivery. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Waitlist signups captured on the public landing page while the app is in
 * private testing. Public `join()` is idempotent per email; admin `list()`
 * powers the dashboard view of who's waiting.
 */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @InjectRepository(WaitlistSignup)
    private readonly repo: Repository<WaitlistSignup>,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Add an email to the waitlist. Idempotent: a repeat (case-insensitive) email
   * returns the existing row rather than erroring, so the UI can always show a
   * friendly "you're on the list" state.
   */
  async join(input: {
    email?: string;
    name?: string;
    source?: string;
    ipAddress?: string;
  }): Promise<{ joined: boolean; alreadyOnList: boolean }> {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || email.length > 320) {
      throw new BadRequestException('Please enter a valid email address.');
    }
    const name = (input.name ?? '').trim().slice(0, 200) || null;
    const source = (input.source ?? '').trim().slice(0, 200) || null;
    const ipAddress = (input.ipAddress ?? '').trim().slice(0, 64) || null;

    const existing = await this.repo.findOne({ where: { email } });
    if (existing) return { joined: true, alreadyOnList: true };

    try {
      await this.repo.save(this.repo.create({ email, name, source, ipAddress }));
      // Fire-and-forget — a mail hiccup must never fail the signup.
      void this.sendWelcomeEmail(email, name);
      return { joined: true, alreadyOnList: false };
    } catch (e) {
      // A race can still trip the unique index — treat as already-on-list.
      const msg = (e as Error).message ?? '';
      if (/duplicate|unique/i.test(msg)) {
        return { joined: true, alreadyOnList: true };
      }
      this.logger.error(`Waitlist join failed: ${msg}`);
      throw new BadRequestException('Could not join the waitlist. Try again.');
    }
  }

  /**
   * Queue the branded "you're on the list" welcome email. Only called for
   * brand-new signups (join() is idempotent, so repeats never re-send).
   */
  private async sendWelcomeEmail(email: string, name: string | null) {
    try {
      const siteLink =
        (
          this.configService.get<string>('email.HOST_URL') ||
          this.configService.get<string>('APP_HOST_URL') ||
          'https://cardcade.fun'
        ).replace(/\/$/, '') || 'https://cardcade.fun';
      await this.queueService.addEmailJob(
        {
          toAddress: [email],
          subject: "You're on the CardCade waitlist! 🎉",
          params: { name: name ?? '', siteLink },
        } as EmailPayloadDto,
        EmailType.WaitlistWelcome,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to queue waitlist welcome email for ${email}: ${(err as Error)?.message}`,
      );
    }
  }

  /** Admin: list signups, newest first, with a total count. */
  async list(
    limit = 50,
    offset = 0,
  ): Promise<{ total: number; data: WaitlistSignupDto[] }> {
    const [rows, total] = await this.repo.findAndCount({
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
      skip: Math.max(offset, 0),
    });
    return {
      total,
      data: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name ?? null,
        source: r.source ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /** Admin: total number of signups (for a dashboard stat). */
  async count(): Promise<number> {
    return this.repo.count();
  }
}
