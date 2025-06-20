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
} from '@nestjs/swagger';
import { UserProfileResponseDto } from './dto/user.response.dto';
import { ProfileUpdateDto } from './dto/user.requests.dto';

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

  /**
   * Updates the profile of the currently logged-in user.
   * @param req - The request object containing user information.
   * @param profileUpdateDto - The data to update the user profile.
   * @returns The updated user profile details.
   */
  @ApiOperation({
    summary: 'Update user profile',
    description:
      'This endpoint updates the profile of the currently logged-in user.',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile updated successfull',
    type: User,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid data' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateProfile(
    @Request() req: RequestWithUser,
    @Body() profileUpdateDto: ProfileUpdateDto,
  ) {
    const data = await this.usersService.profileUpdate(
      req.user.id,
      profileUpdateDto,
    );
    return {
      data,
      message: 'User profile updated successfully',
      statusCode: HttpStatus.OK,
    };
  }
}
