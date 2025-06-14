import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { UserProfileResponseDto } from './dto/response.dto';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}
  /**
   * Retrieves the profile of the currently logged-in user.
   * @param req - The request object containing user information.
   * @returns The user profile details.
   */
  @ApiOperation({
    summary: 'Get all users',
    description: 'This endpoint retrieves a list of all registered users.',
  })
  @ApiOperation({
    summary: 'Get current login user details',
    description:
      'This endpoint retrieves the profile of the currently logged-in user.',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: [UserProfileResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Request() req: RequestWithUser) {
    const data = await this.usersService.findOne(req.user.id);
    return {
      data,
      message: 'User profile retrieved successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({ summary: 'Update user profile' })
  @ApiBody({
    schema: {
      properties: {
        username: { type: 'string', description: 'Username' },
        email: {
          type: 'string',
          format: 'email',
          description: 'Email address',
        },
        profile: {
          type: 'object',
          properties: {
            displayName: { type: 'string' },
            bio: { type: 'string' },
            avatarUrl: { type: 'string' },
          },
          description: 'User profile information',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'User profile updated successfully',
    type: User,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid data' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(
    @Request() req: RequestWithUser,
    @Body() updateData: Partial<User>,
  ) {
    // Remove sensitive fields that shouldn't be updated directly
    const {
      password: _password,
      role: _role,
      isActive: _isActive,
      ...safeUpdateData
    } = updateData;
    return this.usersService.update(req.user.id, safeUpdateData);
  }
}
