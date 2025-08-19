import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCoinPackageMigration1755515899887 implements MigrationInterface {
    name = 'CreateCoinPackageMigration1755515899887'

    public async up(queryRunner: QueryRunner): Promise<void> {
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
              'coin/2cf96dfd-ebb1-49d1-8414-c01372752772-coin.svg',
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
              'coin-stack/85bab892-0687-40ea-8a8a-5a99380e4368-coin-stack.svg',
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
              'coin-bundle/609f012f-f9cc-48c0-9905-7ba3bfbd0082-coin-bundle.svg',
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
              'coin/2cf96dfd-ebb1-49d1-8414-c01372752772-coin.svg',
              true,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
          DELETE FROM coin_packages
          WHERE name IN ('Starter Pack', 'Silver Pack', 'Gold Pack', 'Mega Pack')
        `);
    }

}
