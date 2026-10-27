import 'dotenv/config';
import { buildApp } from './app';
import { config } from './config';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { logger } from './lib/logger';
import { startEmailWorker } from './lib/queue/email.worker';

async function start() {
  try {
    const app = await buildApp();

    // Initialize background workers
    const emailWorker = startEmailWorker();

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);

      await emailWorker.close();
      await app.close();
      await prisma.$disconnect();
      await redis.quit();

      logger.info('Server shut down complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Start server
    await app.listen({
      port: config.PORT,
      host: config.HOST,
    });

    logger.info(`Server running at http://${config.HOST}:${config.PORT}`);
    logger.info(`Environment: ${config.NODE_ENV}`);

    if (config.NODE_ENV === 'development') {
      logger.info(`API Docs available at http://${config.HOST}:${config.PORT}/docs`);
    }
  } catch (error) {
    logger.fatal(error);
    process.exit(1);
  }
}

start();
