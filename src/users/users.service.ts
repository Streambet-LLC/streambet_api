import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcrypt';
import {
  FilterDto,
  ProfileUpdateDto,
  Sort,
  Range,
  UserFilterDto,
  UserUpdateDto,
} from './dto/user.requests.dto';
import { UserResponseDto } from './dto/user.response.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async findAll(): Promise<User[]> {
    return this.usersRepository.find({
      order: { createdAt: 'DESC' },
    });
  }
  /**
   * Retrieves a user by their ID.
   * @param id - The ID of the user to retrieve.
   * @returns The user details or throws NotFoundException if not found.
   */
  async findOne(id: string): Promise<UserResponseDto> {
    try {
      const user = await this.usersRepository.findOne({
        where: { id },
        relations: ['wallet'],
      });
      if (!user) {
        throw new NotFoundException(
          `we couldn't find a user matching that information`,
        );
      }

      const { password: _unused, wallet, ...sanitizedUser } = user;
      const result = {
        ...sanitizedUser,
        wallet_balance: user.wallet?.freeTokens ?? 0,
      };
      // Exclude password from the response
      return result;
    } catch (e) {
      console.error(`Error finding user with ID ${id}:`, e);
      throw new NotFoundException((e as Error).message);
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async findByEmailOrUsername(identifier: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: [{ email: ILike(identifier) }, { username: ILike(identifier) }],
    });
  }
  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { username } });
  }

  async findByRefreshToken(refreshToken: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { refreshToken },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { id } });
  }

  async create(userData: Partial<User>): Promise<User> {
    const user = this.usersRepository.create(userData);
    return this.usersRepository.save(user);
  }

  async update(id: string, userData: Partial<User>): Promise<UserResponseDto> {
    await this.usersRepository.update({ id }, userData);
    return this.findOne(id);
  }

  async profileUpdate(
    id: string,
    profileUpdateDto: ProfileUpdateDto,
  ): Promise<UserResponseDto> {
    try {
      const existingUserObj = await this.usersRepository.findOne({
        where: { id },
      });
      if (!existingUserObj) {
        throw new NotFoundException('User not found');
      }
      if (profileUpdateDto?.newPassword) {
        if (profileUpdateDto?.currentPassword) {
          if (
            profileUpdateDto?.currentPassword === profileUpdateDto?.newPassword
          ) {
            throw new NotFoundException(
              'Old password and new password cannot be the same',
            );
          }
          const isCurrentPasswordValid = await bcrypt.compare(
            profileUpdateDto.currentPassword,
            existingUserObj.password,
          );
          if (!isCurrentPasswordValid) {
            throw new NotFoundException('Old password is incorrect');
          }
          const salt = await bcrypt.genSalt();
          const hashedNewPassword = await bcrypt.hash(
            profileUpdateDto.newPassword,
            salt,
          );
          profileUpdateDto.password = hashedNewPassword;
          delete profileUpdateDto.currentPassword;
          delete profileUpdateDto.newPassword;
        } else {
          throw new NotFoundException(
            'Old password is required to update the password',
          );
        }
      }
      if (profileUpdateDto?.username) {
        const existingUserWithUsername = await this.findByUsername(
          profileUpdateDto.username,
        );
        if (existingUserWithUsername && existingUserWithUsername.id !== id) {
          throw new NotFoundException(
            'Username already exists. Please choose a different username.',
          );
        }
      }
      await this.usersRepository.update({ id }, profileUpdateDto);
      return this.findOne(id);
    } catch (e) {
      console.error(`Error updating profile for user with ID ${id}:`, e);
      throw new NotFoundException((e as Error).message);
    }
  }

  async findAllUser(
    userFilterDto: UserFilterDto,
  ): Promise<{ data: User[]; total: number }> {
    const sort: Sort = userFilterDto.sort
      ? (JSON.parse(userFilterDto.sort) as Sort)
      : undefined;

    const filter: FilterDto = userFilterDto.filter
      ? (JSON.parse(userFilterDto.filter) as FilterDto)
      : undefined;
    const range: Range = userFilterDto.range
      ? (JSON.parse(userFilterDto.range) as Range)
      : [0, 10];
    const { pagination = true } = userFilterDto;

    const usersQB = this.usersRepository
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.wallet', 'wallet');

    // Filtering by query string (username or email)
    if (filter.q) {
      usersQB.andWhere(
        `(LOWER(u.username) ILIKE LOWER(:q) OR LOWER(u.email) ILIKE LOWER(:q))`,
        { q: `%${filter.q}%` },
      );
    }

    // Sorting logic
    if (sort) {
      const [sortColumn, sortOrder] = sort;
      usersQB.orderBy(
        `u.${sortColumn}`,
        sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
      );
    }
    usersQB.andWhere('u.deleted_at IS  NULL');
    // Count before applying pagination
    const total = await usersQB.getCount();

    // Pagination logic
    if (range && pagination) {
      const [offset, limit] = range;
      usersQB.offset(offset).limit(limit);
    }

    // Fetch paginated or full data
    const data = await usersQB.getMany();

    return { data, total };
  }

  async updateUserStatus(
    userUpdateDto: UserUpdateDto,
  ): Promise<{ result: boolean; message: string } | undefined> {
    const { userId, userStatus } = userUpdateDto;
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Update Users table to activate user and sconst et status
    const { affected } = await this.usersRepository
      .createQueryBuilder()
      .update(User)
      .set({ isActive: userStatus })
      .where('id = :userId', { userId })
      .execute();
    const message = userStatus
      ? 'User activated successfully'
      : 'User deactivated successfully';

    return { result: !!affected, message };
  }

  async updatePassword(userId: string, hashedPassword: string): Promise<void> {
    await this.usersRepository.update(userId, {
      password: hashedPassword,
    });
  }

  async verifyUser(userId: string): Promise<void> {
    await this.usersRepository.update(userId, {
      isVerify: true,
    });
  }
}
