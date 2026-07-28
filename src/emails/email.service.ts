import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
const fs = require('fs');
const ejs = require('ejs');
import { Validator } from 'jsonschema';
import _ from 'lodash';
const nodemailer = require('nodemailer');
const path = require('path');
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailPayloadDto } from './dto/email.dto';
import { EmailLog } from './entities/email-log.entity';
import { EmailType } from 'src/enums/email-type.enum';

/**
 * Waitlist mode: only these email types are actually delivered. Every other
 * transactional email (bets, purchases, auctions, reminders, admin notices…)
 * is suppressed at this single choke point — logged with status 'suppressed'
 * but never handed to SMTP. Add a type back here to re-enable it.
 */
const ENABLED_EMAIL_TYPES: ReadonlySet<string> = new Set([
  EmailType.WaitlistWelcome,
  EmailType.AccountVerification,
  EmailType.PasswordReset,
  // Portfolio price alerts are user-requested (they set the target), so they
  // stay enabled through waitlist mode.
  EmailType.PriceAlert,
]);

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);

  constructor(
    private configService: ConfigService,
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
  ) {
    const useMailHog = this.configService.get<boolean>('email.USE_MAILHOG');
    const nodeEnv = process.env.NODE_ENV;

    if (useMailHog) {
      const mailhogHost =
        this.configService.get<string>('email.MAILHOG_HOST') || 'localhost';
      const mailhogSmtpPort = Number(
        this.configService.get<number>('email.MAILHOG_PORT') || 1025,
      );
      // MailHog web UI is usually at 8025
      this.logger.log(
        `Email Service (NODE_ENV=${nodeEnv}) - Using MailHog SMTP at ${mailhogHost}:${mailhogSmtpPort} (Web UI: http://${mailhogHost}:8025)`,
      );
    } else {
      this.logger.log(
        `Email Service (NODE_ENV=${nodeEnv}) - Emails will be sent via SMTP host`,
      );
    }
  }
  /**
   * Overrides the existing credentials for the
   * AWS and updates them without requiring a reload
   */

  // Deprecated: AWS SDK transport removed in favor of SMTP (Nodemailer)

  public async getEmailHtml(payload: EmailPayloadDto, emailtype) {
    if (this.validSchema(payload, emailtype)) {
      const schemaMapping = this.configService.get<string>(
        'email.schemaMapping',
      );
      const templatePath = schemaMapping[emailtype]['templatePath'];

      const emailHTML = await this.getHTML(templatePath, payload.params);
      return emailHTML;
    } else {
      throw new HttpException(
        'Please provide correct schema to validate and a payload validating it',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  public async sendEmailSMTP(payload: EmailPayloadDto, emailtype) {
    if (!ENABLED_EMAIL_TYPES.has(emailtype)) {
      this.logger.log(
        `Email type "${emailtype}" suppressed (waitlist mode) — not sending to ${(payload.toAddress || []).join(',')}`,
      );
      await this.writeEmailLog(payload, emailtype, 'suppressed', null, null);
      return { message: 'Email suppressed (waitlist mode)', statusCode: HttpStatus.OK };
    }
    try {
      const schemaMapping = this.configService.get<string>(
        'email.schemaMapping',
      );
      if (!this.validSchema(payload, emailtype)) {
        throw new HttpException(
          'Please provide correct schema to validate and a payload validating it',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      const templatePath = schemaMapping[emailtype]['templatePath'];
      const emailHTML = await this.getHTML(templatePath, payload.params);
      if (!emailHTML || !templatePath) {
        const erroMessage = JSON.stringify(
          this.setResponse(400, [
            {
              code: '01',
              source: 'Email template or Email params in payload',
              message:
                'Please provide correct Email template and correct email params',
              detail:
                'Template path is provided via config and Params via Payload',
            },
          ]),
        );
        throw new HttpException(erroMessage, HttpStatus.INTERNAL_SERVER_ERROR);
      }
      const result = await this.sendEmailFn(
        await this.emailParams(payload),
        emailHTML,
      );
      await this.writeEmailLog(
        payload,
        emailtype,
        'sent',
        null,
        (result as { messageId?: string })?.messageId ?? null,
      );
      return result;
    } catch (err) {
      await this.writeEmailLog(
        payload,
        emailtype,
        'failed',
        err instanceof Error ? err.message : String(err),
        null,
      );
      throw err;
    }
  }

  /**
   * Best-effort audit row for an email send attempt. Never throws — logging
   * must not break the send path.
   */
  private async writeEmailLog(
    payload: EmailPayloadDto,
    emailtype: string,
    status: 'sent' | 'failed' | 'suppressed',
    error: string | null,
    messageId: string | null,
  ): Promise<void> {
    try {
      const params = (payload.params ?? null) as Record<string, unknown> | null;
      const relatedOrderId =
        params && typeof params.orderId === 'string' ? params.orderId : null;
      await this.emailLogRepository.save(
        this.emailLogRepository.create({
          emailType: emailtype,
          toAddress: (payload.toAddress || []).join(','),
          subject: payload.subject ?? null,
          params,
          relatedOrderId,
          status,
          error,
          messageId,
        }),
      );
    } catch (e) {
      Logger.error(`Failed to write email log (${emailtype}): ${e}`);
    }
  }

  async sendEmailFn(email, emailHTML) {
    try {
      const useMailHog = this.configService.get<boolean>('email.USE_MAILHOG');
      let transporter, send;
      let mailhogHost: string;
      let mailhogPort: number;

      if (useMailHog) {
        // Development Mode: Use MailHog
        mailhogHost =
          this.configService.get<string>('email.MAILHOG_HOST') ?? 'localhost';
        mailhogPort = Number(
          this.configService.get<number>('email.MAILHOG_PORT') ?? 1025,
        );

        this.logger.debug(
          `Development Mode: Using MailHog SMTP at ${mailhogHost}:${mailhogPort}`,
        );

        transporter = nodemailer.createTransport({
          host: mailhogHost,
          port: mailhogPort,
          secure: false,
          ignoreTLS: true,
          tls: {
            rejectUnauthorized: false,
          },
        });
      } else {
        // Production/Staging Mode: Use SMTP (Amazon SES SMTP endpoint)
        const host = this.configService.get<string>('email.SMTP_HOST');
        const port = Number(this.configService.get<number>('email.SMTP_PORT'));
        const secure = this.configService.get<boolean>('email.SMTP_SECURE');
        const user = this.configService.get<string>('email.SMTP_USER');
        const pass = this.configService.get<string>('email.SMTP_PASSWORD');

        this.logger.debug(
          `Production Mode: Using SMTP ${host}:${port} (secure=${secure}) with user ${user ? 'set' : 'missing'}`,
        );

        transporter = nodemailer.createTransport({
          host,
          port,
          secure,
          auth: { user, pass },
        });
      }

      // Verify the transporter configuration before attempting to send
      try {
        await transporter.verify();
        this.logger.debug('SMTP transporter verified successfully');
      } catch (verifyErr) {
        this.logger.error('Failed to verify SMTP transporter', verifyErr);
        throw new HttpException(
          `SMTP transport verification failed: ${verifyErr?.message ?? 'unknown error'}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      send = await transporter.sendMail({
        from: {
          name: this.configService.getOrThrow('email.defaultName', {
            infer: true,
          }),
          address:
            email.from || this.configService.get<string>('email.FROM_EMAIL'),
        },
        to: email.to,
        cc: email.cc,
        bcc: email.bcc,
        attachments: email.attachments,
        subject: email.subject,
        html: emailHTML,
      });

      if (send) {
        if (useMailHog) {
          this.logger.log(
            `Email sent to MailHog SMTP - View at http://${mailhogHost}:8025`,
          );
        } else {
          this.logger.log('Email sent successfully via SMTP');
        }
        return {
          message: 'Email sent successfully',
          statusCode: HttpStatus.OK,
          messageId: (send as { messageId?: string })?.messageId,
        };
      }
    } catch (e) {
      Logger.error('Error while sending email', e);
      throw new HttpException(
        `Email sending failed: ${e?.message ?? 'unknown error'}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
  async emailParams(emailDetails) {
    const details = {
      to: (emailDetails.toAddress || []).join(','),
      from: emailDetails.fromAddress,
      cc: (emailDetails.cc || []).join(','),
      bcc: (emailDetails.bcc || []).join(','),
      subject: emailDetails.subject,
    };
    return await details;
  }

  async validSchema(payload, emailtype) {
    try {
      const schemaMapping = this.configService.get<string>(
        'email.schemaMapping',
      );

      const schemaPath = schemaMapping[emailtype]['schemaPath'];

      const payloadVerification = await this.verifyPayload(payload, schemaPath);

      return payloadVerification.valid;
    } catch (e) {
      Logger.error(`Error while validating ejs ${e}`);
    }
  }
  async verifyPayload(payload, schemaPath) {
    const schema = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), schemaPath), 'utf8'),
    );
    const verifier = new Validator();
    return await verifier.validate(payload, schema);
  }

  setResponse(status_code, error_list = []) {
    return {
      status: status_code,
      errors: error_list,
    };
  }

  getHTML(templateFile, params) {
    const filePath = path.join(process.cwd(), templateFile);
    try {
      const baseHTML = fs.readFileSync(filePath, 'utf8');
      return ejs.render(baseHTML, { params });
    } catch (e) {
      Logger.error(
        `Error rendering EJS template at ${filePath} with params ${JSON.stringify(params)}: ${e}`,
      );
      throw new HttpException(
        `Error rendering email template: ${e.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
