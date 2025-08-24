import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCoinPackageMigration1755515899887
  implements MigrationInterface
{
  name = 'CreateCoinPackageMigration1755515899887';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create table matching entity definition
    await queryRunner.query(`
          CREATE TABLE IF NOT EXISTS coin_packages (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name varchar(255) NOT NULL,
            total_amount decimal(10,2) NOT NULL,
            description text NULL,
            sweep_coin_count decimal(10,2) NOT NULL,
            gold_coin_count bigint NOT NULL,
            image_url varchar(500) NULL,
            status boolean DEFAULT true,
            "createdAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          )
        `);

    // Seed initial data
    await queryRunner.query(`
          INSERT INTO coin_packages (
            id,
            name,
            total_amount,
            description,
            sweep_coin_count,
            gold_coin_count,
            image_url,
            status,
            "createdAt",
            "updatedAt"
          ) VALUES
            (
              gen_random_uuid(),
              'Starter Pack',
              10.00,
              NULL,
              1000.00,
              1000,
              'coin/641158a0-877c-4093-9e8f-0a45b1cb028d-coin1.png',
              true,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            ),
            (
              gen_random_uuid(),
              'Silver Pack',
              15.00,
              NULL,
              5000.00,
              5000,
              'coin-stack/4c86b0df-5691-4d24-bf49-8f1d829214ad-coin2.png',
              true,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            ),
            (
              gen_random_uuid(),
              'Gold Pack',
              20.00,
              NULL,
              10000.00,
              10000,
              'coin-bundle/b8ac69a9-5b14-40dc-88a7-361c7032e3ff-coin3.png',
              true,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            ),
            (
              gen_random_uuid(),
              'Mega Pack',
              25.00,
              NULL,
              25000.00,
              25000,
              'coin/641158a0-877c-4093-9e8f-0a45b1cb028d-coin1.png',
              true,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS coin_packages`);
  }
}
