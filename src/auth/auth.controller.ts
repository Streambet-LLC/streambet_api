import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
  Get,
  Res,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, UserNameDto } from './dto/register.dto';
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

  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({
    status: 201,
    description: 'User successfully registered',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        username: { type: 'string' },
        email: { type: 'string' },
        accessToken: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Bad request - validation error' })
  @ApiResponse({
    status: 409,
    description: 'Conflict - Email or username already exists',
  })
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    const { user, accessToken } = await this.authService.register(registerDto);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      accessToken,
    };
  }

  @Post('username')
  async usernameExists(@Body() usernameDto: UserNameDto) {
    const username = usernameDto.username;
    await this.authService.usernameExists(username);
  }

  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({
    status: 200,
    description: 'User successfully logged in',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        username: { type: 'string' },
        email: { type: 'string' },
        role: { type: 'string' },
        accessToken: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid credentials',
  })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const { user, accessToken } = await this.authService.login(loginDto);
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      accessToken,
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
