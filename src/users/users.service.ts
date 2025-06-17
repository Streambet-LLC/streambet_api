import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcrypt';
import { ProfileUpdateDto } from './dto/user.requests.dto';
import { UserResponseDto } from './dto/user.response.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
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
      const user = await this.usersRepository.findOne({ where: { id } });
      if (!user) {
        throw new NotFoundException(
          'we couldn’t find a user matching that information',
        );
      }
      const { password: _unused, ...sanitizedUser } = user;
      // Exclude password from the response
      return sanitizedUser;
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
    return this.usersRepository.findOne({
      where: { username: ILike(username) },
    });
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
              'Current password and new password cannot be the same',
            );
          }
          const isCurrentPasswordValid = await bcrypt.compare(
            profileUpdateDto.currentPassword,
            existingUserObj.password,
          );
          if (!isCurrentPasswordValid) {
            throw new NotFoundException('Current password is incorrect');
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
            'Current password is required to update the password',
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
}
