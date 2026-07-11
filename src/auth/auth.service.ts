import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto, UserRegistrationResponseDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UsersService } from '../users/users.service';
import { WalletsService } from '../wallets/wallets.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User } from '../users/entities/user.entity';
import { ConfigService } from '@nestjs/config';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JsonWebTokenError } from 'jsonwebtoken';
import ms from 'ms';
import type { StringValue } from 'ms';
import { userVerificationDto } from './dto/verify-password.dto';
import { NotificationService } from 'src/notification/notification.service';
import { UserRole } from 'src/enums/user-role.enum';
import { PromoCodeService } from 'src/promo-code/promo-code.service';
import { isEmpty } from 'lodash-es';
import { MixpanelService } from 'src/integrations/mixpanel/mixpanel.service';
import { AnalyticsEvent } from 'src/integrations/mixpanel/analytics-events';

// Define Google OAuth profile interface
interface GoogleProfile {
  email: string;
  name: {
    givenName: string;
    familyName?: string;
  };
  profileImageUrl: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private walletsService: WalletsService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private notificationService: NotificationService,
    private promoCodeService: PromoCodeService,
    private mixpanel: MixpanelService,
  ) {}

  private calculateAge(birthDate: Date): number {
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  }

  /**
   * Registers a new user with the provided registration details.
   * @param registerDto - The registration details including email, password, profileImageUrl, isOlder, tosAccepted, username, lastKnownIP.
   * @returns The created user details along with an access token and refresh token.
   */
  async register(
    registerDto: RegisterDto,
  ): Promise<UserRegistrationResponseDto> {
    try {
      const {
        name,
        email,
        password,
        profileImageUrl,
        tosAccepted,
        username,
        lastKnownIp,
        dob,
        redirect,
        promoCode,
        refLink,
      } = registerDto;
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
        name,
        username,
        email,
        password: hashedPassword,
        profileImageUrl,
        tosAcceptanceTimestamp: new Date(),
        accountCreationDate: new Date(),
        role: UserRole.USER,
        lastKnownIp,
        dateOfBirth: dob,
        promoCode,
        refLink,
      });

      // Create wallet for the user
      await this.walletsService.create(user.id);

      // credit promo code
      let appliedPromo: Awaited<
        ReturnType<typeof this.promoCodeService.creditPromo>
      > = null;
      if (!isEmpty(promoCode)) {
        appliedPromo = await this.promoCodeService.creditPromo(
          user.id,
          promoCode,
        );
      }

      // Analytics: the server owns the canonical "User Signed Up" event (the
      // web client only calls identify() on signup success) and seeds the
      // Mixpanel profile so it exists even if the client SDK is blocked.
      this.mixpanel.setPeople(user.id, {
        $email: user.email,
        $name: user.name || user.username,
        username: user.username,
        signedUpAt: new Date().toISOString(),
      });
      this.mixpanel.track(AnalyticsEvent.USER_SIGNED_UP, user.id, {
        username: user.username,
        hasPromoCode: !isEmpty(promoCode),
        referred: !!refLink,
      });

      // Generate tokens
      await this.sendAccountVerificationEmail(user, redirect);

      // If the promo code the user entered is ALSO a cart discount code,
      // surface that to the client so they can be reminded to use it at
      // checkout (works on buys, not auctions).
      let discountCodeAlsoAvailable:
        | { code: string; description: string }
        | undefined;
      if (
        appliedPromo &&
        this.promoCodeService.isDiscountConfigured(appliedPromo) &&
        appliedPromo.isActive &&
        (!appliedPromo.expiresAt || new Date() <= appliedPromo.expiresAt)
      ) {
        let description = 'Discount available at checkout';
        if (
          appliedPromo.discountPercent &&
          Number(appliedPromo.discountPercent) > 0
        ) {
          description = `${Number(appliedPromo.discountPercent)}% off at checkout`;
        } else if (
          appliedPromo.discountAmountCents &&
          Number(appliedPromo.discountAmountCents) > 0
        ) {
          description = `$${(Number(appliedPromo.discountAmountCents) / 100).toFixed(2)} off at checkout`;
        }
        discountCodeAlsoAvailable = {
          code: appliedPromo.code,
          description,
        };
      }

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        discountCodeAlsoAvailable,
      };
    } catch (e) {
      this.logger.error('Error in AuthService.register:', e);
      throw new BadRequestException((e as Error).message);
    }
  }
  private async checkValidUser(
    user: User | null,
    redirect: string | undefined,
  ): Promise<void> {
    if (!user) {
      throw new UnauthorizedException(
        `We couldn't find an account with the provided username or email.`,
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Your account is not active. Please contact support.',
      );
    }

    if (!user.isVerify) {
      await this.sendAccountVerificationEmail(user, redirect);
      throw new UnauthorizedException(
        'Your account is not verified. Please check your email for verification instructions.',
      );
    }
  }
  /**
   * Logs in a user with the provided email and password.
   * @param loginDto - The login details including email/username and password.
   * @param rememberMe - Optional rememberMe parameter to set access token expiry to 30 days if true, otherwise use the default from config.
   * @returns The user details along with an access token and refresh token.
   */
  async login(loginDto: LoginDto) {
    try {
      const { identifier, password, remember_me, redirect } = loginDto;
      const user = await this.usersService.findByEmailOrUsername(identifier);

      await this.checkValidUser(user, redirect);
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        throw new UnauthorizedException(
          'The password you entered is incorrect. Give it another try.',
        );
      }
      await this.usersService.update(user.id, { lastLogin: new Date() });

      // Generate tokens
      let accessToken: string;
      if (remember_me === true) {
        accessToken = this.generateToken(user, '30d' as StringValue);
      } else {
        const defaultExpiry = this.resolveExpiry(
          this.configService.get<string>('auth.jwtExpiresIn'),
          '1d' as StringValue,
        );
        accessToken = this.generateToken(user, defaultExpiry);
      }
      const refreshToken = await this.generateRefreshToken(user);

      return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        accessToken,
        refreshToken,
      };
    } catch (e) {
      this.logger.error('Error in AuthService.login:', e);
      throw new BadRequestException((e as Error).message);
    }
  }

  /**
   * Verifies a JWT refresh token.
   * @param token - The refresh token to verify.
   * @returns The decoded payload or null if invalid.
   */
  verifyRefreshToken(token: string): JwtPayload | null {
    try {
      const refreshTokenSecret = this.configService.get<string>(
        'auth.refreshTokenSecret',
      );
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: refreshTokenSecret,
      });

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
  verifyAccessToken(token: string): JwtPayload | null {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get('auth.jwtSecret'),
      });

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
  /**
   * Logs out a user by invalidating their refresh token.
   * @param userId - The user ID.
   */
  async logout(userId: string): Promise<void> {
    try {
      await this.usersService.update(userId, {
        refreshToken: null,
        refreshTokenExpiresAt: null,
      });
    } catch (e) {
      this.logger.error('Error in AuthService.logout:', e);
      throw new BadRequestException('Error during logout');
    }
  }

  /**
   * Turn a configured token-expiry value into something jsonwebtoken accepts.
   * Env vars can arrive blank, quoted (`'1d'`), or whitespace-padded — dotenv
   * won't override a bad value already set in the shell — and any of those makes
   * jsonwebtoken throw "expiresIn should be a number of seconds or string
   * representing a timespan", blocking every login. Sanitize, validate against
   * `ms`, and fall back to a sane default instead of 500-ing the request.
   */
  private resolveExpiry(
    raw: string | undefined,
    fallback: StringValue,
  ): StringValue {
    const cleaned = (raw ?? '')
      .trim()
      .replace(/^['"]+|['"]+$/g, '')
      .trim();
    if (!cleaned) return fallback;
    if (/^\d+$/.test(cleaned)) return cleaned as StringValue; // seconds
    try {
      if (typeof ms(cleaned as StringValue) === 'number') {
        return cleaned as StringValue;
      }
    } catch {
      // ms() throws on unparseable strings — treat as invalid
    }
    this.logger.warn(
      `Invalid token expiry "${raw}"; falling back to "${fallback}".`,
    );
    return fallback;
  }

  generateToken(user: User, expiresIn?: StringValue): string {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    if (expiresIn) {
      return this.jwtService.sign(payload, { expiresIn });
    }
    return this.jwtService.sign(payload);
  }

  async generateRefreshToken(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    const refreshTokenSecret = this.configService.get<string>(
      'auth.refreshTokenSecret',
    );
    const refreshTokenExpiresIn = this.resolveExpiry(
      this.configService.get<string>('auth.refreshTokenExpiresIn'),
      '30d' as StringValue,
    );

    // Generate JWT refresh token
    const refreshToken = this.jwtService.sign(payload, {
      secret: refreshTokenSecret,
      expiresIn: refreshTokenExpiresIn,
    });

    // Calculate expiration date for database storage
    const expiresAt = new Date();
    if (refreshTokenExpiresIn.includes('d')) {
      const days = parseInt(refreshTokenExpiresIn.replace('d', ''));
      expiresAt.setDate(expiresAt.getDate() + days);
    } else if (refreshTokenExpiresIn.includes('h')) {
      const hours = parseInt(refreshTokenExpiresIn.replace('h', ''));
      expiresAt.setHours(expiresAt.getHours() + hours);
    } else if (refreshTokenExpiresIn.includes('m')) {
      const minutes = parseInt(refreshTokenExpiresIn.replace('m', ''));
      expiresAt.setMinutes(expiresAt.getMinutes() + minutes);
    } else if (refreshTokenExpiresIn.includes('s')) {
      const seconds = parseInt(refreshTokenExpiresIn.replace('s', ''));
      expiresAt.setSeconds(expiresAt.getSeconds() + seconds);
    }

    // Save refresh token to database
    await this.usersService.update(user.id, {
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
    });

    return refreshToken;
  }

  // Method for Google OAuth validation - will be expanded later
  async validateOAuthUser(
    profile: GoogleProfile,
  ): Promise<{ user: User; accessToken: string; refreshToken: string }> {
    const { email, name, profileImageUrl } = profile;

    let user = await this.usersService.findByEmail(email);

    if (!user) {
      // Create new user for Google auth
      const baseUsername = name.givenName || email.split('@')[0];
      const username = await this.generateUsernameSuggestion(baseUsername);

      user = await this.usersService.create({
        username,
        email,
        isGoogleAccount: true,
        tosAccepted: true,
        isVerify: true,
        tosAcceptedAt: new Date(),
        role: UserRole.USER,
        password: '',
        profileImageUrl,
        accountCreationDate: new Date(),
        tosAcceptanceTimestamp: new Date(),
        lastLogin: new Date(),
      });
      // Create wallet for the user
      await this.walletsService.create(user.id);
      await this.notificationService.sendSMTPForWelcome(
        user.id,
        user.email,
        username,
      );
    }
    // Generate tokens
    const accessToken = this.generateToken(user);
    const refreshToken = await this.generateRefreshToken(user);
    await this.usersService.update(user.id, { lastLogin: new Date() });
    return { user, accessToken, refreshToken };
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

  public async sendAccountVerificationEmail(
    user: User,
    redirect: string | undefined,
  ) {
    try {
      const token = this.jwtService.sign(
        { sub: user.id },
        {
          secret: this.configService.get('auth.jwtSecret'),
          expiresIn: '1d' as StringValue,
        },
      );

      return await this.notificationService.sendSMTPForAccountVerification(
        user.id,
        redirect,
        token,
        user,
      );
    } catch (e) {
      this.logger.error(
        'Error in AuthService.sendAccountVerificationEmail:',
        e,
      );
    }
  }

  async verifyUser(userVerificationDto: userVerificationDto) {
    // Verify passwords match
    const { token } = userVerificationDto;
    try {
      // Verify token and extract user ID
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('auth.jwtSecret'),
      });

      // Get user
      const user = await this.usersService.findUserByUserId(payload.sub);

      if (!user) {
        throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
      }
      if (user.isVerify)
        throw new HttpException(
          'User Already verified',
          HttpStatus.BAD_REQUEST,
        );
      // Update password
      await this.usersService.verifyUser(user.id);
      const name = user.name || user.username;
      await this.notificationService.sendSMTPForWelcome(
        user.id,
        user.email,
        name,
      );
      return {
        message: 'User Verified successfully',
        statusCode: HttpStatus.OK,
      };
    } catch (error) {
      if (error instanceof JsonWebTokenError) {
        throw new HttpException(
          'Invalid or expired reset token',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { identifier } = forgotPasswordDto;
    const { redirect } = forgotPasswordDto;
    // Find user by email or username
    const user = await this.usersService.findByEmailOrUsername(identifier);

    await this.checkValidUser(user, redirect);
    if (user.isGoogleAccount) {
      throw new UnauthorizedException(
        'This account was created using Google Sign-In. Please continue logging in with Google.',
      );
    }
    // Generate password reset token (valid for 1 hour)

    const token = this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.configService.get('auth.jwtSecret'),
        expiresIn: '1h' as StringValue,
      },
    );

    const resetLink = redirect
      ? `${this.configService.get('email.HOST_URL')}/reset-password?token=${token}&redirect=${redirect}`
      : `${this.configService.get('email.HOST_URL')}/reset-password?token=${token}`;

    try {
      // Send password reset email
      const name = user.name || user.username;
      await this.notificationService.sendSMTPForPasswordReset(
        user.email,
        name,
        resetLink,
      );
    } catch (error) {
      throw new HttpException(
        'Unable to send password reset email. Please try again later.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    // Verify passwords match
    const { token } = resetPasswordDto;

    try {
      // Verify token and extract user ID
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('auth.jwtSecret'),
      });

      // Get user
      const user = await this.usersService.findUserByUserId(payload.sub);
      if (!user) {
        throw new HttpException('Invalid token', HttpStatus.BAD_REQUEST);
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(
        resetPasswordDto.newPassword,
        10,
      );

      // Update password
      await this.usersService.updatePassword(user.id, hashedPassword);

      return {
        message: 'Password has been reset successfully',
        statusCode: HttpStatus.OK,
      };
    } catch (error) {
      if (error instanceof JsonWebTokenError) {
        throw new HttpException(
          'Invalid or expired reset token',
          HttpStatus.BAD_REQUEST,
        );
      }
      throw new HttpException(
        'Error resetting password',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
