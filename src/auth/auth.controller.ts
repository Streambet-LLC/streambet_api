import {
  Controller,
  Post,
  Body,
  HttpStatus,
  UseGuards,
  Request,
  Get,
  Res,
  Query,
  Logger,
} from '@nestjs/common';
import { AuthService } from './auth.service';

import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RefreshTokenGuard } from './guards/refresh-token.guard';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { User } from '../users/entities/user.entity';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import {
  RegisterDto,
  UserNameDto,
  UserRegistrationResponseDto,
} from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { userVerificationDto } from './dto/verify-password.dto';
import { GeoFencingGuard } from 'src/geo-fencing/geo-fencing.guard';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

// Define the Google auth response type
interface GoogleAuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}
  /**
   * Registers a new user with the provided registration details.
   * @param registerDto - The registration details including  email, password, profileImageUrl, isOlder, tosAccepted, username, lastKnownIP,
   * @returns The created user details along with an access token.
   */

  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  @ApiResponse({
    status: 409,
    description: 'Conflict - Email or username already exists',
  })
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'This endpoint allows users to register by providing their email, password, profileImageUrl(optional), isOlder, tosAccepted, username, lastKnownIP(optional). It returns the created user details along with an access token.',
  })
  @ApiResponse({
    status: 201,
    description: 'User created successfully.',
    type: UserRegistrationResponseDto,
  })
  @ApiBody({ type: RegisterDto })
  @UseGuards(GeoFencingGuard)
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    const data = await this.authService.register(registerDto);
    return {
      data,
      message: 'User registered successfully',
      statusCode: HttpStatus.CREATED,
    };
  }

  /**
   * Logs in a user with the provided email and password.
   * @param loginDto - The login details including email and password.
   * @returns The user details along with an access token.
   */
  @Get('username')
  async usernameExists(@Query() usernameDto: UserNameDto) {
    const username = usernameDto.username;
    const data = await this.authService.usernameExists(username);
    return data;
  }

  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({
    status: 409,
    description: 'Conflict - Invalid credentials',
  })
  @ApiOperation({
    summary: 'Login user using email or username',
    description:
      'This endpoint allows users to log in by providing their email/username and password. It returns the user details along with an access token.',
  })
  @ApiResponse({
    status: 201,
    description: 'User login successfully.',
    type: UserRegistrationResponseDto,
  })
  @ApiBody({ type: LoginDto })
  @UseGuards(GeoFencingGuard)
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const data = await this.authService.login(loginDto);
    return {
      data,
      message: 'User logged in successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({
    summary: 'Check location is restricted or not',
    description:
      'This endpoint is used for developement. This will check the current user location is restricted or not.',
  })
  @ApiResponse({
    status: 201,
    description: 'Location is not restricted',
  })
  @UseGuards(GeoFencingGuard)
  @Get('location-check')
  async locationRestriction() {
    return {
      data: true,
      message: 'Location is not restricted',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully',
    type: UserRegistrationResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized Invalid or expired refresh token',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiBearerAuth()
  @UseGuards(RefreshTokenGuard, GeoFencingGuard)
  @Post('refresh')
  async refreshToken(@Request() req: RequestWithUser) {
    // User is already validated by RefreshTokenGuard
    const newAccessToken = this.authService.generateToken(req.user);
    const newRefreshToken = await this.authService.generateRefreshToken(
      req.user,
    );

    const data = {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };

    return {
      data,
      message: 'Token refreshed successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({ summary: 'Logout user and invalidate refresh token' })
  @ApiResponse({
    status: 200,
    description: 'User logged out successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or expired token',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Request() req: RequestWithUser) {
    await this.authService.logout(req.user.id);
    return {
      message: 'User logged out successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({ summary: 'Get the Old user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or expired token',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, GeoFencingGuard)
  @Get('me')
  getProfile(@Request() req: RequestWithUser) {
    // The user is automatically injected into the request by the JwtAuthGuard
    const { password: _unused, ...result } = req.user;

    return {
      data: result,
      message: 'User profile retrieved successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({ summary: 'Initiate Google OAuth2 authentication flow' })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Google authentication page',
  })
  @Get('google')
  @UseGuards(AuthGuard('google'), GeoFencingGuard)
  async googleAuth(): Promise<void> {
    // This route triggers Google OAuth2 flow
    // The actual implementation is handled by Passport
    await Promise.resolve(); // Add await to satisfy linter
    return;
  }

  @ApiOperation({ summary: 'Handle Google OAuth2 callback' })
  @ApiResponse({
    status: 302,
    description: 'Redirects to frontend with authentication tokens',
  })
  @Get('google/callback')
  @UseGuards(AuthGuard('google'), GeoFencingGuard)
  async googleAuthRedirect(
    @Request() req: { user: GoogleAuthResponse },
    @Res() res: Response,
  ): Promise<void> {
    try {
      // Log the user object for debugging
      // this.logger.log('Google callback user:', req.user);
      // this.logger.log('Available keys:', Object.keys(req.user || {}));

      // Verify tokens exist
      if (!req.user?.accessToken || !req.user?.refreshToken) {
        this.logger.error('Missing tokens in callback:', {
          hasAccessToken: !!req.user?.accessToken,
          hasRefreshToken: !!req.user?.refreshToken,
          userKeys: Object.keys(req.user || {}),
        });
        throw new Error('Missing authentication tokens');
      }

      const { accessToken, refreshToken } = req.user;

      // Get client URL from config
      const clientUrl = this.configService.get<string>(
        'app.clientUrl',
        'http://localhost:8080',
      );

      // Ensure proper URL formatting
      const baseUrl = clientUrl.endsWith('/')
        ? clientUrl.slice(0, -1)
        : clientUrl;
      const redirectUrl = `${baseUrl}/auth/google-callback?token=${accessToken}&refreshToken=${refreshToken}`;
      return res.redirect(redirectUrl);
    } catch (error) {
      this.logger.error('Google OAuth callback error:', error);

      const clientUrl = this.configService.get<string>(
        'app.clientUrl',
        'http://localhost:8080',
      );

      const baseUrl = clientUrl.endsWith('/')
        ? clientUrl.slice(0, -1)
        : clientUrl;
      const errorUrl = `${baseUrl}/auth/google-callback?error=oauth_failed`;

      return res.redirect(errorUrl);
    }
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request password reset',
    description: "Send a password reset link to the user's email",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Password reset email sent successfully',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Error sending password reset email',
  })
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset password',
    description: 'Reset password using the token received via email',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Password reset successful',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid token or passwords do not match',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Error resetting password',
  })
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Post('verify-email')
  @ApiOperation({
    summary: 'Verify email',
    description: 'Verify email using the token received via email',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User Verification successful',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid token ',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Error while verifying user',
  })
  async verifyUser(@Body() userVerificationDto: userVerificationDto) {
    return this.authService.verifyUser(userVerificationDto);
  }
}
