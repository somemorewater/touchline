async function start() {
  try {
    const { env } = await import('./config/env.js');
    const { buildApp } = await import('./app.js');
    const { sql } = await import('./database/client.js');

    const app = await buildApp();

    try {
      await sql`select 1`;
      app.log.info('database connection verified');
    } catch (error) {
      app.log.error(
        { err: error },
        'database is unavailable at startup; readiness will report 503 until it recovers',
      );
    }

    try {
      await app.listen({ host: env.HOST, port: env.PORT });
    } catch (error) {
      app.log.error({ err: error }, 'failed to start HTTP server');
      await app.close();
      process.exitCode = 1;
      return;
    }

    let shuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals) => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info({ signal }, 'shutting down');
      try {
        await app.close();
        process.exit(0);
      } catch (error) {
        app.log.error({ err: error }, 'graceful shutdown failed');
        process.exit(1);
      }
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`TOUCHLINE API failed to start: ${message}`);
    process.exitCode = 1;
  }
}

await start();
