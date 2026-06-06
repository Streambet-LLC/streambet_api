import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

/**
 * eBay Marketplace Account Deletion / Closure notification endpoint
 * (required for all production eBay apps).
 *
 * Two behaviors on the SAME public URL:
 *  - GET  ?challenge_code=...  → validation. eBay expects us to return
 *      SHA256(challengeCode + verificationToken + endpointUrl) as hex, in JSON
 *      `{ "challengeResponse": "<hash>" }`, HTTP 200.
 *  - POST { notification: { data: { username, userId, eiasToken } } } → an eBay
 *      user closed their account; we must acknowledge with 200 and delete any
 *      PII we hold for them. CardCade uses eBay only for app-level sold-listings
 *      search (client_credentials) and stores no eBay-account-linked user data,
 *      so there is nothing to delete — we just log + acknowledge.
 *
 * Config (env): EBAY_VERIFICATION_TOKEN (32–80 chars, [A-Za-z0-9_-]) and
 * EBAY_DELETION_ENDPOINT (the EXACT public URL entered in the eBay portal —
 * it is part of the validation hash, so it must match character-for-character).
 *
 * Public + unauthenticated by design (eBay calls it with no credentials).
 */
@ApiTags('webhook')
@Controller('webhook/ebay')
export class EbayAccountDeletionController {
  private readonly logger = new Logger(EbayAccountDeletionController.name);

  constructor(private readonly configService: ConfigService) {}

  @Get('account-deletion')
  @ApiOperation({ summary: 'eBay account-deletion endpoint validation (challenge)' })
  verifyChallenge(@Query('challenge_code') challengeCode: string): {
    challengeResponse: string;
  } {
    if (!challengeCode) {
      throw new BadRequestException('Missing challenge_code');
    }
    const verificationToken = this.configService.get<string>(
      'EBAY_VERIFICATION_TOKEN',
    );
    const endpoint = this.configService.get<string>('EBAY_DELETION_ENDPOINT');
    if (!verificationToken || !endpoint) {
      this.logger.error(
        'eBay account-deletion not configured: set EBAY_VERIFICATION_TOKEN and EBAY_DELETION_ENDPOINT',
      );
      throw new BadRequestException(
        'eBay account-deletion endpoint is not configured',
      );
    }

    // Order matters: challengeCode + verificationToken + endpoint.
    const challengeResponse = createHash('sha256')
      .update(challengeCode)
      .update(verificationToken)
      .update(endpoint)
      .digest('hex');

    return { challengeResponse };
  }

  @Post('account-deletion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'eBay marketplace account deletion notification' })
  handleDeletion(@Body() body: Record<string, any>): { received: boolean } {
    const data = body?.notification?.data ?? {};
    this.logger.log(
      `eBay marketplace account deletion received: username=${data.username ?? 'n/a'} userId=${data.userId ?? 'n/a'}`,
    );
    // CardCade stores no eBay-account-linked user PII, so there is nothing to
    // delete. Acknowledge so eBay marks the notification handled.
    return { received: true };
  }
}
