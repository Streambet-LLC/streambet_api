# Database Migrations

This directory contains database migrations for the Streambet platform.

## Migration Commands

### Generate a new migration

To generate a new migration based on entity changes:

```bash
npm run migration:generate --name=MigrationName
```

Replace `MigrationName` with a descriptive name for your migration.

### Create an empty migration

To create an empty migration file for manual SQL:

```bash
npm run migration:create --name=MigrationName
```

### Run pending migrations

To run all pending migrations:

```bash
npm run migration:run
```

### Revert the last migration

To revert the most recently applied migration:

```bash
npm run migration:revert
```

### Sync database with initial schema

To generate and run an initial migration that matches the current entity schema:

```bash
npm run db:sync
```

## Migration Best Practices

1. Always run migrations in development before pushing to production
2. Never modify an existing migration file that has been applied to any environment
3. Create a new migration for any schema changes
4. Test both up and down migrations to ensure they work correctly
5. Be careful with destructive changes (dropping tables, columns, etc.)
6. Add comments to complex migrations to explain the changes
7. Review migration SQL before applying to production

## TypeORM Configuration

The TypeORM configuration for migrations is defined in `typeorm.config.ts` in the project root. 