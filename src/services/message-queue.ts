import { logger } from '../utils/logger.js';

export class MessageQueue {
  private queues = new Map<string, Promise<void>>();

  enqueue(sessionId: string, task: () => Promise<void>): Promise<void> {
    const current = this.queues.get(sessionId) ?? Promise.resolve();
    const next = current.then(() => task()).catch((err) => {
      logger.error(`Queue task failed for session ${sessionId}:`, err);
    });
    this.queues.set(sessionId, next);
    return next;
  }

  remove(sessionId: string): void {
    this.queues.delete(sessionId);
  }

  async drain(): Promise<void> {
    logger.info(`Draining ${this.queues.size} session queues...`);
    await Promise.allSettled([...this.queues.values()]);
    logger.info('All queues drained');
  }
}
