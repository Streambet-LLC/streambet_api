import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
  HttpStatus,
  Param,
  Post,
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
import {
  NotificationSettingsUpdateDto,
  ProfileUpdateDto,
} from './dto/user.requests.dto';
import { UserAddressDto } from './dto/user-address.dto';
import { CreateNewReferralLinkDto } from 'src/referral/create-referral-link.requests.dto';
import { ReferralService } from 'src/referral/referral.service';
import { OptionalJwtAuthGuard } from 'src/auth/guards/optional-jwt-auth.guard';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly referralService: ReferralService,
  ) {}
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
   * Get authenticated user's address for redemption form pre-population.
   * Security: Only returns address to the authenticated user for their own data.
   * @param req - The request object containing authenticated user information.
   * @returns The user's shipping address.
   */
  @ApiOperation({
    summary: 'Get own address',
    description:
      "Returns authenticated user's shipping address. Only accessible to the user themselves.",
  })
  @ApiResponse({
    status: 200,
    description: 'Address retrieved successfully',
    type: UserAddressDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me/address')
  async getOwnAddress(@Request() req: RequestWithUser) {
    const user = await this.usersService.findOneWithAddress(req.user.id);
    const addressData: UserAddressDto = {
      address: user.address || null,
      address2: user.address2 || null,
      city: user.city || null,
      state: user.state || null,
      zipCode: user.zipCode || null,
      country: user.country || null,
    };
    return {
      data: addressData,
      message: 'Address retrieved successfully',
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

  @ApiOperation({
    summary: 'Gets leaderboard',
    description: 'This endpoint gets the top 20 users by gold balance',
  })
  @ApiResponse({
    status: 200,
    description: 'Leaderboard fetched successfully',
  })
  @Get('leaderboard')
  async getLeaderboard() {
    const data = await this.usersService.getLeaderboard();

    return {
      data,
      message: 'Leaderboard fetched successfully',
      statusCode: HttpStatus.OK,
    };
  }

  /**
   * Public endpoint to get platform statistics for landing page.
   * Returns total count of active users.
   */
  @ApiOperation({
    summary: 'Get platform stats',
    description:
      'Public endpoint returning total active user count for landing page display',
  })
  @ApiResponse({
    status: 200,
    description: 'Platform stats fetched successfully',
  })
  @Get('stats')
  async getPlatformStats() {
    const totalUsers = await this.usersService.getUsersCount();

    return {
      data: {
        totalUsers,
      },
      message: 'Platform stats fetched successfully',
      statusCode: HttpStatus.OK,
    };
  }

  /**
   * Updates the profile of the currently logged-in user.
   * @param req - The request object containing user information.
   * @param username - The username of the user.
   * @returns The user profile details.
   */
  @ApiOperation({
    summary: 'Gets user profile',
    description: 'This endpoint gets the profile of the provided username',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile fetched successful',
    type: User,
  })
  @ApiBearerAuth()
  @ApiResponse({ status: 400, description: 'Bad request - Invalid data' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @UseGuards(OptionalJwtAuthGuard)
  @Get('profile/:username')
  async getUserProfile(
    @Request() req: RequestWithUser,
    @Param('username') username: string,
  ) {
    const data = await this.usersService.getUserProfile(
      req.user ? req.user.id : null,
      username,
    );

    return {
      data,
      message: 'Profile fetched successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({
    summary: 'Follow user profile',
    description: 'This endpoint follows a user profile',
  })
  @ApiResponse({
    status: 200,
    description: 'Followed/Unfollowed Successfully',
  })
  @ApiBearerAuth()
  @ApiResponse({ status: 400, description: 'Bad request - Invalid data' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @UseGuards(JwtAuthGuard)
  @Get('profile/:username/follow')
  async followUser(
    @Request() req: RequestWithUser,
    @Param('username') username: string,
  ) {
    const data = await this.usersService.followUser(req.user.id, username);

    return {
      data,
      message: 'Profile followed successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({
    summary: 'Unfollow user profile',
    description: 'This endpoint unfollows a user profile',
  })
  @ApiResponse({
    status: 200,
    description: 'Followed/Unfollowed Successfully',
  })
  @ApiBearerAuth()
  @ApiResponse({ status: 400, description: 'Bad request - Invalid data' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @UseGuards(JwtAuthGuard)
  @Get('profile/:username/unfollow')
  async unfollowUser(
    @Request() req: RequestWithUser,
    @Param('username') username: string,
  ) {
    const data = await this.usersService.unfollowUser(req.user.id, username);

    return {
      data,
      message: 'Profile unfollowed successfully',
      statusCode: HttpStatus.OK,
    };
  }

  /**
   * Updates the notification settings of the currently logged-in user.
   * @param req - The request object containing user information.
   * @param notificationSettingsUpdateDto - The data to update the user's notification settings.
   * @returns The updated notification settings.
   */
  @ApiOperation({
    summary: 'Update user notification settings',
    description:
      'This endpoint updates the notification settings of the currently logged-in user.',
  })
  @ApiResponse({
    status: 200,
    description: 'User notification settings updated successfully',
    type: User,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid data' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Patch('notification-settings')
  async updateNotificationSettings(
    @Request() req: RequestWithUser,
    @Body() notificationSettingsUpdateDto: NotificationSettingsUpdateDto,
  ) {
    const data = await this.usersService.updateNotificationSettings(
      req.user.id,
      notificationSettingsUpdateDto,
    );
    return {
      data,
      message: 'User notification settings updated successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({
    summary: 'Gets all creators',
    description: 'This endpoint gets all the creators',
  })
  @ApiResponse({
    status: 200,
    description: 'Creator list fetched successful',
    type: User,
  })
  @Get('creators')
  async getCreators() {
    const data = await this.usersService.getCreators();

    return {
      data,
      message: 'Creator list fetched successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({
    summary: 'Gets all sellers',
    description: 'Public endpoint that returns all active sellers',
  })
  @ApiResponse({
    status: 200,
    description: 'Seller list fetched successfully',
    type: User,
  })
  @Get('sellers')
  async getSellers() {
    const { data } = await this.usersService.findAllSellers();

    return {
      data: data.map((s) => ({
        id: s.id,
        username: s.username,
        displayName: s.shopName || s.name || s.username,
        profileImageUrl: s.profileImageUrl || null,
      })),
      message: 'Seller list fetched successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({
    summary: 'Create New Referral Link',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('referral-link')
  async createNewReferralLink(
    @Request() req: RequestWithUser,
    @Body() newLinkDto: CreateNewReferralLinkDto,
  ) {
    const data = await this.referralService.createReferralLink(
      req.user.id,
      newLinkDto.code,
    );
    return {
      data,
      message: 'New referral link created successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({
    summary: 'Create New Referral Link',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('referral-link')
  async getReferralLinks(@Request() req: RequestWithUser) {
    const data = await this.referralService.getReferralLinks(req.user.id);
    return {
      data,
      message: 'Success',
      statusCode: HttpStatus.OK,
    };
  }
}
