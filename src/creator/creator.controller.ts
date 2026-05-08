import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatorService } from './creator.service';
import { CreatorApplicationDto } from './dto/creator-application.dto';

interface RequestWithUser extends ExpressRequest {
  user: { id: string; userId?: string; email?: string };
}

/**
 * Application + seller-onboarding endpoints. Mounted at `/creator/*` for
 * backward compatibility with the existing frontend client. Creator-role
 * endpoints (streams, analytics, payouts) were removed in Phase 3 cleanup.
 */
@Controller('creator')
@UseGuards(JwtAuthGuard)
export class CreatorController {
  constructor(private readonly creatorService: CreatorService) {}

  @Post('application')
  async createApplication(
    @Body() applicationDto: CreatorApplicationDto,
    @Request() req: RequestWithUser,
  ) {
    return this.creatorService.upsertCreatorApplication({
      userId: req.user.userId ?? req.user.id,
      applicationDto,
    });
  }

  @Patch('application')
  async updateApplication(
    @Body() applicationDto: CreatorApplicationDto,
    @Request() req: RequestWithUser,
  ) {
    return this.creatorService.upsertCreatorApplication({
      userId: req.user.userId ?? req.user.id,
      applicationDto,
    });
  }

  @Get('application')
  async getApplication(@Request() req: RequestWithUser) {
    return this.creatorService.getCreatorApplication({
      userId: req.user.userId ?? req.user.id,
    });
  }

  @Delete('application')
  async cancelApplication(@Request() req: RequestWithUser) {
    return this.creatorService.cancelCreatorApplication({
      userId: req.user.userId ?? req.user.id,
    });
  }

  @Post('create-connect-link')
  async createConnectLink(@Request() req: RequestWithUser) {
    return this.creatorService.createConnectLink(req.user);
  }
}
