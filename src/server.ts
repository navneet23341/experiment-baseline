import 'dotenv/config';
import { app } from './app';
import { pool } from './db/pool';

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, () => {
  console.log(`agentRelay listening on port ${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
