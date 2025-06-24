import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  HttpStatus,
} from '@nestjs/common';
import { StreamService } from './stream.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
} from '@nestjs/swagger';
import { StreamFilterDto } from './dto/list-stream.dto';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('stream')
@Controller('stream')
export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  /**
   * Retrieves a list of live or filtered streams for the homepage, with optional pagination.
   *
   * @param userFilterDto - The filter and pagination options, including:
   *   - streamStatus: (optional) The status of streams to filter by (e.g., 'live').
   *   - range: (optional) A JSON string representing the offset and limit for pagination.
   *   - pagination: (optional) A boolean to enable or disable pagination (defaults to true).
   *
   * @returns An object containing:
   *   - data: A list of raw stream records, each with id, streamName, and thumbnailURL.
   *   - total: The total number of matching streams.
   */
  @ApiOperation({
    summary: 'List live and sheduled streams for home page',
    description:
      'Retrieves a list of users with support for pagination, range, and filtering. Pass "pagination=false" to retrieve all users without pagination.',
  })
  @ApiOkResponse({ type: StreamFilterDto })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('home')
  async homePageStreamList(@Query() streamFilterDto: StreamFilterDto) {
    const { total, data } =
      await this.streamService.homePageStreamList(streamFilterDto);
    return {
      statusCode: HttpStatus.OK,
      message: 'Successfully Listed',
      data,
      total,
    };
  }
}
