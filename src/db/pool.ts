import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool(
  connectionString
    ? { connectionString }
    : {
        host: process.env.PGHOST,
        port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
      },
);

pool.on('error', (error) => {
  // Keep idle-client errors visible; request handlers report query errors.
  console.error('Unexpected PostgreSQL pool error', error);
});
