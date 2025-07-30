import {
  Controller,
  Get,
  Query,
  Post,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { CreateChatDto } from './dto/create-chat.dto';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ChatMessagesFilterDto,
  GetMessagesResponseDto,
} from './dto/list-chat.dto';

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * Retrieves a paginated list of chat messages for a given stream.
   * Applies optional pagination using the 'range' parameter in the filter DTO.
   * Returns only user fields: username, email, and profile_image_url for each message.
   * Throws BadRequestException if streamId is not provided.
   *
   * @param filter - ChatMessagesFilterDto containing streamId and optional range.
   * @returns An object with statusCode, message, data (chat messages), and total count.
   */
  @ApiResponse({ status: 200, type: GetMessagesResponseDto })
  @Get('messages')
  async getMessages(@Query() filter: ChatMessagesFilterDto) {
    const { streamId } = filter;

    // Validate required parameter
    if (!streamId) {
      throw new BadRequestException('StreamId is required');
    }

    // Call service method to fetch messages with filtering, sorting, and pagination
    const { data, total } =
      await this.chatService.getMessagesByStreamId(filter);

    return {
      statusCode: 200,
      message: 'Successfully Listed',
      data,
      total,
    };
  }
}
