import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpStatus,
  Ip,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../enums/user-role.enum';
import { User } from '../users/entities/user.entity';
import { WaitlistService } from './waitlist.service';

interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('waitlist')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  /** Public: join the waitlist from the landing page. Idempotent per email. */
  @ApiOperation({ summary: 'Join the waitlist (public)' })
  @Post()
  async join(
    @Body() body: { email?: string; name?: string; source?: string },
    @Ip() ip: string,
  ) {
    const data = await this.waitlist.join({
      email: body?.email,
      name: body?.name,
      source: body?.source,
      ipAddress: ip,
    });
    return {
      status: HttpStatus.OK,
      message: data.alreadyOnList
        ? "You're already on the list."
        : "You're on the list!",
      data,
    };
  }

  /** Admin: list waitlist signups for the dashboard. */
  @ApiOperation({ summary: 'List waitlist signups (admin)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get()
  async list(
    @Request() req: RequestWithUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (req.user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
    const data = await this.waitlist.list(
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
    return { status: HttpStatus.OK, message: 'Waitlist signups', data };
  }
}
