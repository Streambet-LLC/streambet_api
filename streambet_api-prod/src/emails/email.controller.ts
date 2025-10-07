import {
  Body,
  Controller,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { EmailsService } from './email.service';
import {
  EmailOkResponseDto,
  EmailPayloadDto,
  EmailTypeDto,
} from './dto/email.dto';

@ApiTags('Emails')
@Controller('emails')
export class EmailsController {
  constructor(private readonly emailsService: EmailsService) {}

  @ApiOperation({
    tags: ['emails'],
    operationId: 'smtp-emails',
    summary: 'Send Email',
    description: 'Send email with smtp',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Successfuly send email' })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Error while sending email, Please try again',
  })
  @ApiOkResponse({
    type: EmailOkResponseDto,
    description: 'Email Send',
  })
  @Post(':emailType')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async sendEmails(
    @Body() payload: EmailPayloadDto,
    @Param() type: EmailTypeDto,
  ) {
    const emailresponse = await this.emailsService.sendEmailSMTP(
      payload,
      type.emailType,
    );
    return emailresponse;
  }
}
