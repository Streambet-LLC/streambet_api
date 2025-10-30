import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
const fs = require('fs');
const ejs = require('ejs');
import { Validator } from 'jsonschema';
import _ from 'lodash';
const nodemailer = require('nodemailer');
const sesTransport = require('nodemailer-ses-transport');
const path = require('path');
import AWS from 'aws-sdk';
import { ConfigService } from '@nestjs/config';
import { EmailPayloadDto } from './dto/email.dto';

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);

  constructor(private configService: ConfigService) {
    const useMailHog = this.configService.get<boolean>('email.USE_MAILHOG');
    const nodeEnv = process.env.NODE_ENV;
    
    if (useMailHog) {
      const mailhogHost = this.configService.get<string>('email.MAILHOG_HOST') || 'localhost';
      const mailhogPort = this.configService.get<number>('email.MAILHOG_PORT') || 8025;
      const mailhogUrl = `http://${mailhogHost}:${mailhogPort}`;
      this.logger.log(`Email Service initialized in (NODE_ENV=${nodeEnv}) mode - All emails will be captured by MailHog at ${mailhogUrl}`);
    } else {
      this.logger.log(`Email Service initialized in (NODE_ENV=${nodeEnv}) mode - Emails will be sent via AWS SES`);
    }
  }
  /**
   * Overrides the existing credentials for the
   * AWS and updates them without requiring a reload
   */

  setAwsConfig() {
    const accessKeyId = this.configService.get<string>('email.SMTP_USER');
    const secretAccessKey = this.configService.get<string>(
      'email.SMTP_PASSWORD',
    );
    const region = this.configService.get<string>('email.SMTP_REGION');
    const awsconfig = new AWS.Config({
      accessKeyId,
      secretAccessKey,
      region,
    });
    return new AWS.SES(awsconfig);
  }

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
    const schemaMapping = this.configService.get<string>('email.schemaMapping');
    if (this.validSchema(payload, emailtype)) {
      const templatePath = schemaMapping[emailtype]['templatePath'];
      const emailHTML = await this.getHTML(templatePath, payload.params);
      if (emailHTML && templatePath) {
        return await this.sendEmailFn(
          await this.emailParams(payload),
          emailHTML,
        );
      } else {
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
    } else {
      throw new HttpException(
        'Please provide correct schema to validate and a payload validating it',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
        mailhogHost = this.configService.get<string>('email.MAILHOG_HOST') ?? 'localhost';
        mailhogPort = Number(this.configService.get<number>('email.MAILHOG_PORT') ?? 8025);
        
        this.logger.debug(`Development Mode: Using MailHog at ${mailhogHost}:${mailhogPort}`);
        
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
        // Production/Staging Mode: Use AWS SES
        const accessKeyId = this.configService.get<string>('email.SMTP_USER');
        const secretAccessKey = this.configService.get<string>(
          'email.SMTP_PASSWORD',
        );
        const region = this.configService.get<string>('email.SMTP_REGION');
        
        this.logger.debug('Production Mode: Using AWS SES');

        transporter = nodemailer.createTransport(
          sesTransport({
            accessKeyId,
            secretAccessKey,
            region,
          }),
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
          this.logger.log(`Email sent to MailHog - View at http://${mailhogHost}:${mailhogPort}`);
        } else {
          this.logger.log('Email sent successfully via AWS SES');
        }
        return {
          message: 'Email sent successfully',
          statusCode: HttpStatus.OK,
        };
      }
    } catch (e) {
      Logger.error('Error While send email', e);
      throw new HttpException(
        `Error while send email`,
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
