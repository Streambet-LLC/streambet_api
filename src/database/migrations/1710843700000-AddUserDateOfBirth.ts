import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserDateOfBirth1710843700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update column names to use snake_case
    await queryRunner.query(`
      DO $$ 
      BEGIN 
        -- Add date_of_birth column if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'date_of_birth'
        ) THEN 
          ALTER TABLE "users" ADD COLUMN "date_of_birth" DATE NULL;
        END IF;

        -- Update is_active column if it exists
        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'isactive'
        ) THEN 
          ALTER TABLE "users" RENAME COLUMN "isactive" TO "is_active";
        END IF;

        -- Update verification_token column if it exists
        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'refreshtoken'
        ) THEN 
          ALTER TABLE "users" RENAME COLUMN "refreshtoken" TO "verification_token";
        END IF;

        -- Update refresh_token_expires_at column if it exists
        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'refreshtokenexpiresat'
        ) THEN 
          ALTER TABLE "users" RENAME COLUMN "refreshtokenexpiresat" TO "refresh_token_expires_at";
        END IF;

        -- Update deleted_at column if it exists
        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'deletedat'
        ) THEN 
          ALTER TABLE "users" RENAME COLUMN "deletedat" TO "deleted_at";
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ 
      BEGIN 
        -- Revert column names back to camelCase
        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'date_of_birth'
        ) THEN 
          ALTER TABLE "users" DROP COLUMN "date_of_birth";
        END IF;

        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'is_active'
        ) THEN 
          ALTER TABLE "users" RENAME COLUMN "is_active" TO "isactive";
        END IF;

        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'verification_token'
        ) THEN 
          ALTER TABLE "users" RENAME COLUMN "verification_token" TO "refreshtoken";
        END IF;

        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'refresh_token_expires_at'
        ) THEN 
          ALTER TABLE "users" RENAME COLUMN "refresh_token_expires_at" TO "refreshtokenexpiresat";
        END IF;

        IF EXISTS (
          SELECT 1 
          FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'deleted_at'
        ) THEN 
          ALTER TABLE "users" RENAME COLUMN "deleted_at" TO "deletedat";
        END IF;
      END $$;
    `);
  }
}
