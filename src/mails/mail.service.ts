// mail.service.ts
import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendWelcomeEmail(to: string, user: { name: string }) {
    console.log({
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT,
      user: process.env.MAIL_USER,
    });

    await this.mailerService.sendMail({
      to: 'revyriedev@gmail.com',
      subject: 'Welcome to StreamBet!',
      template: './welcome', // corresponds to welcome.ejs
      context: {
        name: user.name,
      },
    });
    console.log(`Welcome email sent to ${to}`);
  }
}
