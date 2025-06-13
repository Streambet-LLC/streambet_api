import {
  Controller,
  Post,
  Body,
  HttpStatus,
  UseGuards,
  Request,
  Get,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, UserRegistrationResponseDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { User } from '../users/entities/user.entity';

// Define the request type with user property
interface RequestWithUser extends Request {
  user: User;
}

// Define the Google auth response type
interface GoogleAuthResponse {
  user: User;
  accessToken: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
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
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({
    status: 409,
    description: 'Conflict - Invalid credentials',
  })
  @ApiOperation({
    summary: 'Login a user',
    description:
      'This endpoint allows users to log in by providing their email/username and password. It returns the user details along with an access token.',
  })
  @ApiResponse({
    status: 201,
    description: 'User login successfully.',
    type: UserRegistrationResponseDto,
  })
  @ApiBody({ type: LoginDto })
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const data = await this.authService.login(loginDto);
    return {
      data,
      message: 'User logged in successfully',
      statusCode: HttpStatus.OK,
    };
  }

  @ApiOperation({ summary: 'Get the current user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or expired token',
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getProfile(@Request() req: RequestWithUser) {
    // The user is automatically injected into the request by the JwtAuthGuard
    const { password: _unused, ...result } = req.user;
    return result;
  }

  @ApiOperation({ summary: 'Initiate Google OAuth2 authentication flow' })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Google authentication page',
  })
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(): Promise<void> {
    // This route triggers Google OAuth2 flow
    // The actual implementation is handled by Passport
    await Promise.resolve(); // Add await to satisfy linter
    return;
  }

  @ApiOperation({ summary: 'Handle Google OAuth2 callback' })
  @ApiResponse({
    status: 302,
    description: 'Redirects to frontend with authentication token',
  })
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(
    @Request() req: { user: GoogleAuthResponse },
    @Res() res: Response,
  ): Promise<void> {
    // After successful Google authentication, redirect to frontend with token
    const { accessToken } = req.user;

    // Redirect to frontend with token
    const clientUrl = this.configService.get<string>(
      'CLIENT_URL',
      'http://localhost:3000',
    );

    await Promise.resolve(); // Add await to satisfy linter
    return res.redirect(
      `${clientUrl}/auth/google-callback?token=${accessToken}`,
    );
  }
}
