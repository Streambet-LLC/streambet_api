import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DailySpinService } from './daily-spin.service';
import { SpinResultDto } from './dto/spin-result.dto';
import { SpinStatusDto } from './dto/spin-status.dto';
import { User } from '../users/entities/user.entity';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('daily-spin')
@Controller('daily-spin')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DailySpinController {
  constructor(private readonly dailySpinService: DailySpinService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Get daily spin status',
    description:
      'Check if the user can spin today and when the next spin will be available',
  })
  async getSpinStatus(
    @Req() req: RequestWithUser,
  ): Promise<SpinStatusDto> {
    return this.dailySpinService.getSpinStatus(req.user.id);
  }

  @Post('spin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Execute daily spin',
    description: 'Spin the wheel to receive a random CadeCoin reward',
  })
  async executeSpin(@Req() req: RequestWithUser): Promise<SpinResultDto> {
    return this.dailySpinService.executeSpin(req.user.id);
  }
}
