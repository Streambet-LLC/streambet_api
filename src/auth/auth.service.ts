import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto, UserRegistrationResponseDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User, UserRole } from '../users/entities/user.entity';

// Define Google OAuth profile interface
interface GoogleProfile {
  email: string;
  name: {
    givenName: string;
    familyName?: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private walletsService: WalletsService,
    private jwtService: JwtService,
  ) {}

  /**
   * Registers a new user with the provided registration details.
   * @param registerDto - The registration details including email, password, profileImageUrl, isOlder, tosAccepted, username, lastKnownIP.
   * @returns The created user details along with an access token.
   */
  async register(
    registerDto: RegisterDto,
  ): Promise<UserRegistrationResponseDto> {
    try {
      const {
        email,
        password,
        profileImageUrl,
        isOlder,
        tosAccepted,
        username,
        lastKnownIp,
      } = registerDto;
      if (!isOlder) {
        throw new BadRequestException(
          'You must be over 18 years old to access this service',
        );
      }
      if (!tosAccepted) {
        throw new BadRequestException(
          'Please accept the Terms of Service to continue',
        );
      }

      // Check if user with email or username already exists
      const existingEmail = await this.usersService.findByEmail(email);
      if (existingEmail) {
        throw new ConflictException(
          'This email address is already associated with an existing account',
        );
      }

      const existingUsername = await this.usersService.findByUsername(username);
      if (existingUsername) {
        throw new ConflictException(
          'The chosen username is unavailable. Please select a different one.',
        );
      }

      // Hash password
      const salt = await bcrypt.genSalt();
      const hashedPassword = await bcrypt.hash(password, salt);

      // Create user
      const user = await this.usersService.create({
        username,
        email,
        password: hashedPassword,
        profile_image_url: profileImageUrl,
        tos_acceptance_timestamp: new Date(),
        account_creation_date: new Date(),
        role: UserRole.USER,
        last_known_ip: lastKnownIp,
      });

      // Create wallet for the user
      await this.walletsService.create(user.id);

      // Generate JWT
      const accessToken = this.generateToken(user);

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        accessToken,
      };
    } catch (e) {
      console.error('Error in AuthService.register:', e);
      throw new BadRequestException((e as Error).message);
    }
  }

  /**
   * Logs in a user with the provided email and password.
   * @param loginDto - The login details including email/username and password.
   * @returns The user details along with an access token.
   */
  async login(loginDto: LoginDto): Promise<UserRegistrationResponseDto> {
    try {
      const { identifier, password } = loginDto;
      const user = await this.usersService.findByEmailOrUsername(identifier);

      if (!user) {
        throw new UnauthorizedException(
          `We couldn't find an account with the provided username or email.`,
        );
      }
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        throw new UnauthorizedException(
          'The password you entered is incorrect. Give it another try.',
        );
      }
      await this.usersService.update(user.id, { lastLogin: new Date() });

      // Generate JWT
      const accessToken = this.generateToken(user);

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        accessToken,
      };
    } catch (e) {
      console.error('Error in AuthService.login:', e);
      throw new BadRequestException((e as Error).message);
    }
  }

  generateToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    return this.jwtService.sign(payload);
  }

  verifyToken(token: string): JwtPayload | null {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      if (
        !payload.sub ||
        !payload.username ||
        !payload.email ||
        !payload.role
      ) {
        return null;
      }
      return payload;
    } catch (_: unknown) {
      // Token verification failed
      return null;
    }
  }

  // Method for Google OAuth validation - will be expanded later
  async validateOAuthUser(
    profile: GoogleProfile,
  ): Promise<{ user: User; accessToken: string }> {
    const { email, name } = profile;

    let user = await this.usersService.findByEmail(email);

    if (!user) {
      // Create new user for Google auth
      user = await this.usersService.create({
        username: `${name.givenName}${Math.floor(Math.random() * 10000)}`,
        email,
        isGoogleAccount: true,
        tosAccepted: true,
        tosAcceptedAt: new Date(),
        role: UserRole.USER,
      });

      // Create wallet for the user
      await this.walletsService.create(user.id);
    }

    // Update last login
    await this.usersService.update(user.id, { lastLogin: new Date() });

    // Generate JWT
    const accessToken = this.generateToken(user);

    return { user, accessToken };
  }
  async usernameExists(username: string) {
    const existingUsername = await this.usersService.findByUsername(username);

    if (existingUsername) {
      const suggestion = await this.generateUsernameSuggestion(username);
      return {
        status: HttpStatus.OK,
        message:
          'The chosen username is unavailable. Please select a different one.',
        is_available: false,
        suggestion,
      };
    }

    return {
      status: HttpStatus.OK,
      message: 'Username is available',
      is_available: true,
    };
  }

  private async generateUsernameSuggestion(
    baseUsername: string,
  ): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const suggestion = `${baseUsername}${Math.floor(100 + Math.random() * 900)}`;
      const exists = await this.usersService.findByUsername(suggestion);
      if (!exists) return suggestion;
    }
    return `${baseUsername}_${Date.now()}`;
  }
}
