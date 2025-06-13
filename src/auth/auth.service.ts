import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
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

  async register(
    registerDto: RegisterDto,
  ): Promise<{ user: User; accessToken: string }> {
    const {
      email,
      password,
      profileImageUrl,
      isOlder,
      tosAccepted,
      username,
      lastKnownIP,
    } = registerDto;
    if (!isOlder) {
      throw new BadRequestException(
        'Access is restricted to individuals who are 18 years of age or older.',
      );
    }
    if (!tosAccepted) {
      throw new BadRequestException(
        'Please accept the Terms of Service to continue.',
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
      last_known_ip: lastKnownIP,
    });

    // Create wallet for the user
    await this.walletsService.create(user.id);

    // Generate JWT
    const accessToken = this.generateToken(user);

    return { user, accessToken };
  }

  async login(
    loginDto: LoginDto,
  ): Promise<{ user: User; accessToken: string }> {
    const { email, password } = loginDto;

    // Find user by email
    const user = await this.usersService.findByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if password is correct
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login
    await this.usersService.update(user.id, { lastLogin: new Date() });

    // Generate JWT
    const accessToken = this.generateToken(user);

    return { user, accessToken };
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
      throw new ConflictException(
        'The chosen username is unavailable. Please select a different one.',
      );
    }
    throw new HttpException('Username is available', HttpStatus.OK);
  }
}
