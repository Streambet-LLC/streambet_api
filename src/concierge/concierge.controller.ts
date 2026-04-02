import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  Request,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConciergeService } from './concierge.service';
import { UserRole } from '../enums/user-role.enum';

interface RequestWithUser extends Request {
  user: { id: string; username: string; email: string; role: UserRole };
}

@ApiTags('Concierge')
@Controller('concierge')
export class ConciergeController {
  constructor(private readonly conciergeService: ConciergeService) {}

  @Post('request')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request concierge support (Pro sellers only)' })
  @ApiResponse({ status: 201, description: 'Concierge request created' })
  async createRequest(@Request() req: RequestWithUser) {
    const result = await this.conciergeService.createRequest(req.user.id);
    return {
      data: result,
      message: 'Concierge request submitted successfully',
      statusCode: HttpStatus.CREATED,
    };
  }

  @Get('my-request')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get your concierge request status' })
  @ApiResponse({ status: 200, description: 'Concierge request status' })
  async getMyRequest(@Request() req: RequestWithUser) {
    const result = await this.conciergeService.getUserRequest(req.user.id);
    return {
      data: result,
      message: result ? 'Active request found' : 'No active request',
      statusCode: HttpStatus.OK,
    };
  }

  @Get('admin/requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all concierge requests (Admin)' })
  @ApiResponse({ status: 200, description: 'All concierge requests' })
  async getAllRequests(@Request() req: RequestWithUser) {
    if (req.user.role !== UserRole.ADMIN) {
      return {
        data: null,
        message: 'Unauthorized',
        statusCode: HttpStatus.FORBIDDEN,
      };
    }
    const result = await this.conciergeService.getAllRequests();
    return {
      data: result,
      message: 'Concierge requests retrieved',
      statusCode: HttpStatus.OK,
    };
  }

  @Post('admin/claim/:requestId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Claim a concierge request (Admin)' })
  @ApiResponse({ status: 200, description: 'Request claimed' })
  async claimRequest(
    @Param('requestId') requestId: string,
    @Request() req: RequestWithUser,
  ) {
    if (req.user.role !== UserRole.ADMIN) {
      return {
        data: null,
        message: 'Unauthorized',
        statusCode: HttpStatus.FORBIDDEN,
      };
    }
    const result = await this.conciergeService.claimRequest(
      requestId,
      req.user.id,
    );
    return {
      data: result,
      message: 'Concierge request claimed successfully',
      statusCode: HttpStatus.OK,
    };
  }
}
