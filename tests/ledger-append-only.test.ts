import { describe, it, expect } from 'vitest';
import { prisma } from '@/server/db/client';

// DATA_MODEL §7: the ai_action ledger is append-only, never deleted. The DB
// trigger must reject deletes even from the owner connection.
describe('ai_action append-only ledger', () => {
  it('rejects deleting a ledger row', async () => {
    const action = await prisma.aiAction.create({
      data: { surface: 'scheduler', toolName: 'workshop.ping', tier: 'auto', input: {} },
    });

    await expect(prisma.aiAction.delete({ where: { id: action.id } })).rejects.toThrow(
      /append-only/,
    );

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM ai_action WHERE id = '${action.id}'`),
    ).rejects.toThrow(/append-only/);

    // still present
    const still = await prisma.aiAction.findUnique({ where: { id: action.id } });
    expect(still).not.toBeNull();
  });

  it('allows status updates (approval transitions are not deletes)', async () => {
    const action = await prisma.aiAction.create({
      data: { surface: 'scheduler', toolName: 'workshop.ping', tier: 'auto', input: {} },
    });
    const updated = await prisma.aiAction.update({
      where: { id: action.id },
      data: { status: 'executed', output: { ok: true } },
    });
    expect(updated.status).toBe('executed');
  });
});
