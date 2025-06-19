import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserSoftDeleteFields1710843600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add deletedAt column if it doesn't exist
    await queryRunner.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'deleted_at'
        ) THEN 
          ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMP;
        END IF;
      END $$;
    `);

    // Ensure isActive column exists with default value true
    await queryRunner.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'is_active'
        ) THEN 
          ALTER TABLE "users" ADD COLUMN "is_active" BOOLEAN DEFAULT true;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the columns if they exist
    await queryRunner.query(`
      DO $$ 
      BEGIN 
        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'deleted_at'
        ) THEN 
          ALTER TABLE "users" DROP COLUMN "deleted_at";
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      DO $$ 
      BEGIN 
        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'is_active'
        ) THEN 
          ALTER TABLE "users" DROP COLUMN "is_active";
        END IF;
      END $$;
    `);
  }
}
