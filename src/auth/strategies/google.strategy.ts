import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

// Define Google profile interface for our app
interface GoogleUser {
  email: string;
  name: {
    givenName: string;
    familyName?: string;
  };
  profileImageUrl: string;
}

// Define what we return from the strategy
export interface GoogleAuthResponse {
  userId: string;
  username: string;
  email: string;
  role: string;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    const clientID = configService.get<string>('auth.google.clientID');
    const clientSecret = configService.get<string>('auth.google.clientSecret');
    const callbackURL = configService.get<string>('auth.google.callbackURL');

    // Log Google OAuth config for debugging (mask clientSecret)
    Logger.log('Google OAuth config:', {
      clientID,
      clientSecret,
      callbackURL,
    });

    super({
      clientID: clientID || '',
      clientSecret: clientSecret || '',
      callbackURL: callbackURL || '',
      scope: ['email', 'profile'],
      passReqToCallback: false,
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      // Verify emails array exists and has at least one item
      if (!profile.emails || profile.emails.length === 0 || !profile.name) {
        done(new Error('Invalid Google profile'), null);
        return;
      }

      const googleUser: GoogleUser = {
        email: profile.emails[0].value,
        profileImageUrl: profile.photos?.[0]?.value || '',
        name: {
          givenName: profile.name.givenName,
          familyName: profile.name.familyName,
        },
      };

      Logger.log('Processing Google user:', googleUser.email);

      const {
        user: createdUser,
        accessToken: token,
        refreshToken: userRefreshToken,
      } = await this.authService.validateOAuthUser(googleUser);

      // Create a clean response object without spreading user properties
      // This prevents user entity properties from overwriting our tokens
      const response: GoogleAuthResponse = {
        userId: createdUser.id,
        username: createdUser.username,
        email: createdUser.email,
        role: createdUser.role,
        accessToken: token,
        refreshToken: userRefreshToken,
      };

      Logger.log('Google OAuth success for user:', createdUser.email);
      Logger.log('Response contains tokens:', {
        hasAccessToken: !!response.accessToken,
        hasRefreshToken: !!response.refreshToken,
      });

      done(null, response);
    } catch (error) {
      console.error('Google OAuth validation error:', error);
      done(error as Error, null);
    }
  }
}
