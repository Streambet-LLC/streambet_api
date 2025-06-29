import {
  Controller,
  Get,
  UseGuards,
  Request,
  Query,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { StreamService } from './stream.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { User } from '../users/entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { StreamFilterDto } from './dto/list-stream.dto';
import { Stream } from './entities/stream.entity';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('stream')
@Controller('stream')
export class StreamController {
  constructor(private readonly streamService: StreamService) {}

  /**
   * Retrieves a paginated list of streams for the home page view.
   * Applies optional filters such as stream status and sorting based on the provided DTO.
   * Selects limited fields (id, name, thumbnailUrl) for performance optimization.
   * Handles pagination with a default range of [0, 24] if not specified.
   * Logs and throws an HttpException in case of internal server errors.
   *
   * @param streamFilterDto - DTO containing optional filters: status, sort, and pagination range.
   * @returns A Promise resolving to an object with:
   *          - data: Array of stream records with selected fields.
   *          - total: Total number of matching stream records.
   * @throws HttpException - If an error occurs during query execution.
   * @author Reshma M S
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
  /**
   * Retrieves a stream by its ID with selected fields (id, kickEmbedUrl, name).
   * Throws a NotFoundException if no stream is found with the given ID.
   * Logs and throws an HttpException in case of any internal errors during retrieval.
   *
   * @param id - The unique identifier of the stream to retrieve.
   * @returns A Promise resolving to the stream details.
   * @throws NotFoundException | HttpException
   * @author Reshma M S
   */
  @ApiOperation({ summary: 'Get stream by ID' })
  @ApiParam({ name: 'id', description: 'Stream ID' })
  @ApiResponse({
    status: 200,
    description: 'Stream details retrieved successfully',
  })
  //  @ApiBearerAuth()
  //@UseGuards(JwtAuthGuard)
  @Get('/:id')
  async findStreamById(@Param('id') id: string) {
    const stream = await this.streamService.findStreamById(id);
    return {
      message: 'Stream details retrieved successfully',
      status: HttpStatus.OK,
      data: stream,
    };
  }
}
