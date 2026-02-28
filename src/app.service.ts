import { Injectable } from '@nestjs/common';
import { UsersService } from './users/users.service';

@Injectable()
export class AppService {
  constructor(private readonly usersService: UsersService) {}

  getHello(): string {
    return 'Hello World!';
  }

  /**
   * Get public platform statistics (accessible without authentication)
   * Used for landing page and public-facing displays
   */
  async getPlatformStats() {
    const totalUsers = await this.usersService.getUsersCount();
    return {
      totalUsers,
    };
  }
}
