import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EMAIL_QUEUE } from 'src/common/constants/queue.constants';
import { EmailsService } from 'src/emails/email.service';
import { EmailPayloadDto } from 'src/emails/dto/email.dto';
import { EmailType } from 'src/enums/email-type.enum';

export interface EmailJobData {
  data: EmailPayloadDto;
  type: EmailType;
}

@Injectable()
@Processor(EMAIL_QUEUE)
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private readonly emailsService: EmailsService) {
    super();
  }

  // This method handles jobs from the "email" queue
  async process(job: Job<EmailJobData>): Promise<void> {
    const { data, type } = job.data;

    this.logger.log(`Processing email job for emai-type: ${type}`);

    try {
      await this.emailsService.sendEmailSMTP(data, type);

      this.logger.log(
        `Successfully processed email job for email-type: ${type}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process email job for email-type: ${type}`,
        error.stack,
      );
      throw error;
    }
  }
}
