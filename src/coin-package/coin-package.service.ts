import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CoinPackage } from './entities/coin-package.entity';
import { Repository } from 'typeorm';

@Injectable()
export class CoinPackageService {
  constructor(
    @InjectRepository(CoinPackage)
    private coinPackagesRepository: Repository<CoinPackage>,
  ) {}

  /**
   * Purpose:
   * - Fetch all active coin packages ordered by creation date (latest first).
   */
  async findAll() {
    const coinPackages = await this.coinPackagesRepository.find({
      where: { status: true },
      order: { createdAt: 'DESC' },
    });
    return coinPackages;
  }

  /**
   * Fetch a coin package by its id if active.
   */
  async findById(id: string) {
    return this.coinPackagesRepository.findOne({ where: { id, status: true } });
  }
}
