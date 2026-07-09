import { describe, it, expect, afterAll } from 'vitest';
import { getBoss, stopBoss, NOOP_QUEUE } from '@/server/jobs/queue';

// M0 §8: the job queue runs — a no-op scheduled job proves it processes work.
describe('pg-boss job queue', () => {
  afterAll(async () => {
    await stopBoss();
  });

  it('enqueues and processes a no-op job', async () => {
    const boss = await getBoss();
    await boss.createQueue(NOOP_QUEUE);

    const processed = new Promise<void>((resolve) => {
      void boss.work(NOOP_QUEUE, async () => {
        resolve();
      });
    });

    const jobId = await boss.send(NOOP_QUEUE, { proof: true });
    expect(jobId).toBeTruthy();

    await Promise.race([
      processed,
      new Promise((_, reject) => setTimeout(() => reject(new Error('job not processed')), 20_000)),
    ]);
  });
});
