import { test, expect, type Page } from '@playwright/test';

// M4 exit criterion: enroll → attend 3 sessions → pass quiz → certificate issued
// → verification URL validates.
//
// Fixtures live in prisma/seed.ts (deterministic ids):
//   SESSIONS   = 00000000-0000-0000-0000-0000005e550{1,2,3} (cohort c001)
//   ENROLLMENT = 00000000-0000-0000-0000-0000000e0401  (member-a on c001)
//   QUIZ       = 00000000-0000-0000-0000-000000009401  (published, passPct 70)
//   QUESTIONS  = ...9400a1/a2/a3 with correctKey a/b/c respectively.
const SESSION_IDS = [
  '00000000-0000-0000-0000-0000005e5501',
  '00000000-0000-0000-0000-0000005e5502',
  '00000000-0000-0000-0000-0000005e5503',
];
const ENROLLMENT_ID = '00000000-0000-0000-0000-0000000e0401';
const QUIZ_ID = '00000000-0000-0000-0000-000000009401';
const CORRECT_ANSWERS: Record<string, string> = {
  '00000000-0000-0000-0000-0000009400a1': 'a',
  '00000000-0000-0000-0000-0000009400a2': 'b',
  '00000000-0000-0000-0000-0000009400a3': 'c',
};

// Sign in as any seeded user via the real magic-link dev flow; the session cookie
// lands on the browser context, which page.request shares.
async function signInAs(page: Page, email: string) {
  const res = await page.request.post('/api/auth/magic-link', { data: { email } });
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

test('participant: enroll → attend 3 sessions → pass quiz → certificate issued → verify URL validates', async ({
  page,
}) => {
  // ── 1. Staff records attendance `present` for all 3 sessions ────────────────
  await signInAs(page, 'owner@workshopos.local');

  for (const sessionId of SESSION_IDS) {
    await execTool(page, 'attendance.record', {
      sessionId,
      entries: [{ enrollmentId: ENROLLMENT_ID, status: 'present' }],
    });
  }

  // ── 2. Submit the quiz attempt with the CORRECT answers (staff may score) ───
  const attempt = await page.request.post(`/api/quiz/${QUIZ_ID}/attempt`, {
    data: { enrollmentId: ENROLLMENT_ID, answers: CORRECT_ANSWERS },
  });
  expect(attempt.ok()).toBeTruthy();
  const attemptBody = (await attempt.json()) as {
    scorePct: number;
    passed: boolean;
    completed: boolean;
    certificateId: string | null;
  };
  expect(attemptBody.scorePct).toBeGreaterThanOrEqual(70);
  expect(attemptBody.passed).toBe(true);
  // 100% attendance + a passing quiz ⇒ completion auto-issues the certificate.
  expect(attemptBody.completed).toBe(true);
  expect(attemptBody.certificateId).not.toBeNull();

  // ── 3. Participant sees the certificate tile on their dashboard ─────────────
  await signInAs(page, 'member-a@acme.example');
  await page.goto('/en/me');

  // Attendance KPI reflects 3/3 present.
  await expect(page.getByTestId('attendance-kpi')).toContainText('100%');
  await expect(page.getByTestId('session-row')).toHaveCount(3);

  const certTile = page.getByTestId('cert-tile');
  await expect(certTile).toBeVisible();
  // Signature line "Rajkumar Rajagobalan, Facilitator" (bilingual, substring-safe).
  await expect(certTile).toContainText('Rajkumar Rajagobalan');

  const verifyLink = page.getByTestId('cert-verify-link');
  await expect(verifyLink).toBeVisible();
  const verifyHref = await verifyLink.getAttribute('href');
  expect(verifyHref).toBeTruthy();

  // ── 4. Public verification URL validates and shows the workshop title ───────
  await page.goto(verifyHref!.startsWith('/en') ? verifyHref! : `/en${verifyHref!}`);
  await expect(page.getByTestId('verify-valid')).toBeVisible();
  const verifyResult = page.getByTestId('verify-result');
  await expect(verifyResult).toContainText('Member A');
  // Workshop title appears (ai-fluency-discernment). Assert on the participant name
  // + valid badge (locale-stable) and that the result panel is non-empty.
  await expect(verifyResult).not.toBeEmpty();
});
