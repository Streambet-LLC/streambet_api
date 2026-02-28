import { Controller, Get, HttpStatus } from '@nestjs/common';
import { AppService } from './app.service';
import {
  ApiOperation,
  ApiResponse as SwaggerApiResponse,
} from '@nestjs/swagger';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get public platform statistics (no auth required)',
  })
  @SwaggerApiResponse({
    status: 200,
    description: 'Platform statistics fetched successfully',
    schema: {
      type: 'object',
      properties: {
        totalUsers: { type: 'number', description: 'Total active users' },
      },
    },
  })
  async getPlatformStats() {
    return await this.appService.getPlatformStats();
  }
}
