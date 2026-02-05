import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReferralLink } from './referral-link.entity';

@Injectable()
export class ReferralService {
  constructor(
    @InjectRepository(ReferralLink)
    private readonly referralLinkRepository: Repository<ReferralLink>,
  ) {}

  async createReferralLink(
    userUuid: string,
    code: string,
  ): Promise<{ error: string | null }> {
    let error: string | null = null;
    const codeCount = await this.referralLinkRepository.countBy({
      slug: code,
    });

    if (codeCount > 0) {
      error = 'Code Already Exists';
    } else {
      await this.referralLinkRepository
        .create({
          userUuid,
          slug: code,
        })
        .save();
    }

    return {
      error,
    };
  }

  async getReferralLinks(userUuid: string): Promise<{
    data: {
      code: string;
      count: number;
    }[];
  }> {
    const respData: {
      code: string;
      count: number;
    }[] = await this.referralLinkRepository
      .createQueryBuilder('link')
      .where('link.userUuid = :uuid', {
        uuid: userUuid,
      })
      .select('link.slug', 'code')
      .addSelect('COUNT(user.id)', 'count')
      .leftJoin('link.users', 'user')
      .groupBy('link.slug')
      .getRawMany();

    return {
      data: respData,
    };
  }
}
