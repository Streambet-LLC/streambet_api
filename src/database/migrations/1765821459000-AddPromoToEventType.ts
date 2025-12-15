import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPromoToEventType1765821459000 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'promo'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Note: PostgreSQL does not support removing enum values directly
        // You would need to recreate the enum if downgrade is necessary
        // This is commented out as it's rarely needed and can cause issues
        // await queryRunner.query(`
        //     ALTER TYPE event_type RENAME TO event_type_old;
        //     CREATE TYPE event_type AS ENUM ('stream', 'non-video');
        //     ALTER TABLE streams ALTER COLUMN type TYPE event_type USING type::text::event_type;
        //     DROP TYPE event_type_old;
        // `);
    }

}
