import { Injectable } from '@nestjs/common';
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
    console.log('Google OAuth config:', {
      clientID,
      clientSecret: clientSecret ? 'set' : 'not set',
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
    // Verify emails array exists and has at least one item
    if (!profile.emails || profile.emails.length === 0 || !profile.name) {
      done(new Error('Invalid Google profile'), null);
      return;
    }

    const googleUser: GoogleUser = {
      email: profile.emails[0].value,
      profileImageUrl: profile.photos[0].value,
      name: {
        givenName: profile.name.givenName,
        familyName: profile.name.familyName,
      },
    };

    try {
      const {
        user: createdUser,
        accessToken: token,
        refreshToken: userRefreshToken,
      } = await this.authService.validateOAuthUser(googleUser);

      done(null, {
        ...createdUser,
        accessToken: token,
        refreshToken: userRefreshToken,
      });
    } catch (error) {
      done(error as Error, null);
    }
  }
}
