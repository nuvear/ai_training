import 'server-only';
import PgBoss from 'pg-boss';

export const NOOP_QUEUE = 'system.noop';

// pg-boss manages its own `pgboss` schema, so it uses the DIRECT_URL (admin)
// connection. Strip Prisma-only query params (?schema=…) the pg driver ignores.
function connectionString(): string {
  const raw = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error('DIRECT_URL / DATABASE_URL is not set');
  const url = new URL(raw);
  url.search = '';
  return url.toString();
}

let bossPromise: Promise<PgBoss> | null = null;

/** Starts (once) and returns the shared pg-boss instance. */
export async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    const boss = new PgBoss({ connectionString: connectionString() });
    bossPromise = boss.start().then(() => boss);
  }
  return bossPromise;
}

/** Registers the no-op worker. In M0 this is the proof the queue processes work;
 * later milestones register real workers (reminders, localization, reports). */
export async function registerNoopWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue(NOOP_QUEUE);
  await boss.work(NOOP_QUEUE, async () => {
    // Intentionally does nothing but complete successfully.
    return;
  });
}

export async function scheduleNoop(
  boss: PgBoss,
  data: Record<string, unknown> = {},
): Promise<string> {
  const id = await boss.send(NOOP_QUEUE, { ...data, queuedAt: new Date().toISOString() });
  if (!id) throw new Error('failed to enqueue noop job');
  return id;
}

export async function stopBoss(): Promise<void> {
  if (bossPromise) {
    const boss = await bossPromise;
    await boss.stop({ graceful: false });
    bossPromise = null;
  }
}
