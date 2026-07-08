import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/client';
import { loadInvoicePdfData, renderInvoicePdf } from '@/server/pdf/invoice-pdf';
import { renderReportPdf } from '@/server/pdf/report-pdf';
import { buildOrgReport } from '@/server/domain/org-report';

// Force the deterministic offline narrative (no live model call) so the PDF smoke
// test runs the same in CI whether or not ANTHROPIC_API_KEY is present locally.
vi.stubEnv('ANTHROPIC_API_KEY', '');

// PDF smoke tests: a real bilingual PDF is produced offline (bundled JA font, no
// network). Verifies %PDF magic, non-trivial size, and an embedded font subset so
// JA glyphs render.

const owner = { userId: randomUUID(), role: 'owner' as const, organizationId: null };
const orgId = randomUUID();
const workshopId = randomUUID();
const cohortId = randomUUID();
const orderId = randomUUID();
const invoiceId = randomUUID();

beforeAll(async () => {
  await prisma.user.create({
    data: { id: owner.userId, email: `ip-${owner.userId}@t.local`, role: 'owner' },
  });
  await prisma.organization.create({
    data: {
      id: orgId,
      name: { en: 'Invco', ja: 'インブコ' },
      billingEmail: `ip-${randomUUID()}@t.local`,
    },
  });
  await prisma.workshop.create({
    data: {
      id: workshopId,
      slug: `ip-${workshopId}`,
      title: { en: 'Design Sprint', ja: 'デザインスプリント' },
      summary: { en: 'S', ja: 'エス' },
    },
  });
  await prisma.cohort.create({
    data: {
      id: cohortId,
      workshopId,
      startsAt: new Date(Date.now() + 7 * 864e5),
      endsAt: new Date(Date.now() + 8 * 864e5),
      capacity: 10,
      priceJpy: 40_000,
    },
  });
  await prisma.order.create({
    data: {
      id: orderId,
      buyerUserId: owner.userId,
      organizationId: orgId,
      kind: 'individual_enrollment',
      status: 'paid',
      currency: 'JPY',
      subtotal: 40_000,
      discount: 0,
      tax: 4_000,
      total: 44_000,
      items: { create: [{ cohortId, qty: 1, unitPrice: 40_000 }] },
    },
  });
  await prisma.invoice.create({
    data: {
      id: invoiceId,
      organizationId: orgId,
      orderId,
      number: `INV-TEST-${Date.now()}`,
      dueAt: new Date(Date.now() + 30 * 864e5),
      status: 'issued',
    },
  });
});

afterAll(async () => {
  await prisma.invoice.deleteMany({ where: { id: invoiceId } });
  await prisma.orderItem.deleteMany({ where: { orderId } });
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.cohort.deleteMany({ where: { id: cohortId } });
  await prisma.workshop.deleteMany({ where: { id: workshopId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: owner.userId } });
});

describe('invoice PDF rendering', () => {
  it('renders a real bilingual PDF starting with %PDF, with an embedded font', async () => {
    const data = await loadInvoicePdfData(prisma, invoiceId);
    const pdf = await renderInvoicePdf(data);

    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(2000); // non-trivial
    // Embedded font subset present → JA glyphs are rendered, not tofu.
    expect(pdf.toString('latin1')).toContain('FontFile');
  });
});

describe('org report PDF rendering', () => {
  it('renders a bilingual report PDF with the founder authored-by line embedded', async () => {
    const report = await buildOrgReport(prisma, orgId, '2026-06');
    // Deterministic stub (no ANTHROPIC key in CI) carries the keigo JA narrative.
    expect(report.provider).toBe('stub');
    expect(report.author.en).toBe('Rajkumar Rajagobalan');
    expect(report.author.ja).toBe('ラジクマール・ラジャゴバラン');
    expect(report.narrative.ja).toContain('ございました');

    const pdf = await renderReportPdf(report);
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(2000);
    expect(pdf.toString('latin1')).toContain('FontFile');
  });
});
