import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOtherToPrizeBrandEnum1771621414822
  implements MigrationInterface
{
  name = 'AddOtherToPrizeBrandEnum1771621414822';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add 'other' value to the existing enum
    await queryRunner.query(
      `ALTER TYPE "public"."prize_configurations_brand_enum" ADD VALUE 'other'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL doesn't support removing enum values, so we can't properly rollback
    // This is a limitation of PostgreSQL enums. The value will remain in the type.
    // If a true rollback is needed, the enum type would need to be recreated.
  }
}
