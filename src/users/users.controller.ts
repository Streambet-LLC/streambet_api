import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
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

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: User,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Request() req: RequestWithUser): Promise<User> {
    return this.usersService.findOne(req.user.id);
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
  ): Promise<User> {
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
