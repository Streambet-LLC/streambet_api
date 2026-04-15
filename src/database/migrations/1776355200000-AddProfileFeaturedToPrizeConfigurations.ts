import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddProfileFeaturedToPrizeConfigurations1776355200000
  implements MigrationInterface
{
  name = 'AddProfileFeaturedToPrizeConfigurations1776355200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'prize_configurations',
      new TableColumn({
        name: 'profile_featured',
        type: 'boolean',
        default: false,
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('prize_configurations', 'profile_featured');
  }
}
