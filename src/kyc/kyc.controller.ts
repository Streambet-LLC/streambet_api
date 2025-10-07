import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  UseGuards,
  Request,
  Headers,
  Req,
  RawBodyRequest,
  BadRequestException,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { KycService } from './kyc.service';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  /** Registers user to coinflow using verified Persona KYC inquiry. */
  @ApiOperation({
    summary: 'Registers user to coinflow using verified Persona KYC inquiry',
  })
  @ApiResponse({ status: 201, description: 'Register KYC initiated' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid inquiry ID' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('registerKyc')
  async registerKyc(
    @Request() req: RequestWithUser,
    @Body('inquiryId') inquiryId: string,
  ) {
    return this.kycService.registerKyc(req.user.id, req.user.email, inquiryId);
  }
}
