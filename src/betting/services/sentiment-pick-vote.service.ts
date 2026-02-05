import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SentimentPickVote } from '../entities/sentiment-pick-vote.entity';

@Injectable()
export class SentimentPickVoteService {
  constructor(
    @InjectRepository(SentimentPickVote)
    private sentimentPickVoteRepository: Repository<SentimentPickVote>,
  ) {}

  /**
   * Records that a user has voted on a sentiment pick
   * @param userId - The ID of the user making the vote
   * @param bettingRoundId - The ID of the sentiment betting round
   */
  async recordSentimentVote(
    userId: string,
    bettingRoundId: string,
  ): Promise<SentimentPickVote> {
    // Use upsert to handle case where user has already voted on this round
    const existingVote = await this.sentimentPickVoteRepository.findOne({
      where: { userId, bettingRoundId },
    });

    if (existingVote) {
      return existingVote;
    }

    const vote = this.sentimentPickVoteRepository.create({
      userId,
      bettingRoundId,
    });

    return this.sentimentPickVoteRepository.save(vote);
  }

  /**
   * Checks if a user has ever voted on a sentiment pick
   * @param userId - The ID of the user
   * @param bettingRoundId - The ID of the sentiment betting round
   * @returns true if user has voted, false otherwise
   */
  async hasUserVotedOnSentiment(
    userId: string,
    bettingRoundId: string,
  ): Promise<boolean> {
    const vote = await this.sentimentPickVoteRepository.findOne({
      where: { userId, bettingRoundId },
    });

    return !!vote;
  }

  /**
   * Gets all sentiment rounds a user has voted on
   * @param userId - The ID of the user
   * @returns Array of betting round IDs
   */
  async getUserSentimentVotes(userId: string): Promise<string[]> {
    const votes = await this.sentimentPickVoteRepository.find({
      where: { userId },
      select: ['bettingRoundId'],
    });

    return votes.map((vote) => vote.bettingRoundId);
  }
}
