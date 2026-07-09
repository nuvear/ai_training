import { test, expect, type Page } from '@playwright/test';

async function signInAsOwner(page: Page) {
  const res = await page.request.post('/api/auth/magic-link', {
    data: { email: 'owner@workshopos.local' },
  });
  const { devLoginUrl } = (await res.json()) as { devLoginUrl: string };
  const token = new URL(devLoginUrl).searchParams.get('token')!;
  await page.goto(`/api/auth/callback?token=${token}`);
}

// Invoke a tool via /api/tools/execute; auto-tier returns output directly,
// approve/owner-tier is approved through the queue and its output returned.
async function execTool(page: Page, toolName: string, input: unknown) {
  const res = await page.request.post('/api/tools/execute', { data: { toolName, input } });
  const body = (await res.json()) as {
    output?: unknown;
    requiresApproval?: boolean;
    actionId?: string;
  };
  if (body.requiresApproval) {
    const appr = await page.request.post(`/api/approvals/${body.actionId}/approve`);
    return ((await appr.json()) as { output: unknown }).output;
  }
  return body.output;
}

// M3 exit criterion: org created → 10-seat pool purchased (invoice path) →
// 5 employees assigned → dashboard correct → invoice PDF downloads.
test('org portal: buy 10 seats via invoice, assign 5 employees, download invoice PDF', async ({
  page,
}) => {
  await signInAsOwner(page);
  const stamp = Date.now();

  const { organizationId } = (await execTool(page, 'org.create', {
    name: { en: `Acme ${stamp}`, ja: `アクメ${stamp}` },
    billingEmail: `billing-${stamp}@acme.example`,
    billingMethod: 'invoice_transfer',
  })) as { organizationId: string };

  const offer = (await execTool(page, 'seatpool.create_offer', {
    organizationId,
    seats: 10,
    pricePerSeat: 45000,
    validUntil: '2027-03-31T00:00:00.000Z',
  })) as { seatPoolId: string; invoiceId: string };

  await execTool(page, 'invoice.mark_paid', {
    invoiceId: offer.invoiceId,
    paymentRef: `TXN-${stamp}`,
  });

  const emails = Array.from({ length: 5 }, (_, i) => `emp-${stamp}-${i}@acme.example`);
  await execTool(page, 'org.assign_seats', { seatPoolId: offer.seatPoolId, userEmails: emails });

  // Dashboard reflects the pool (10 seats) and the 5 assigned employees.
  await page.goto(`/en/org/${organizationId}`);
  await expect(page.getByTestId('seats-kpi')).toContainText('10');
  await expect(page.getByTestId('employee-row')).toHaveCount(5);
  await expect(page.getByTestId('invoice-row').first()).toBeVisible();

  // The bilingual invoice PDF downloads.
  const pdf = await page.request.get(`/api/invoices/${offer.invoiceId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('pdf');
  const bytes = await pdf.body();
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
});
