import 'server-only';
import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { Prisma } from '@/generated/prisma';
import { NotFoundError, InvalidStateError } from '@/server/domain/errors';
import { formatDate } from '@/lib/format';
import type { BilingualText } from '@/server/ai/i18n-content';
import { ensureFonts, JP_FONT } from './fonts';

// ─────────────────────────────────────────────────────────────────────────────
// Bilingual completion certificate PDF, rendered ON DEMAND. Carries the
// participant name, workshop title, cohort dates, issue date, and the founder
// signature line (DESIGN §2.1, katakana confirmed in DECISIONS):
//   "Rajkumar Rajagobalan, Facilitator" /
//   "ラジクマール・ラジャゴバラン（ファシリテーター）"
// A verify code footer backs the public verification URL.
// ─────────────────────────────────────────────────────────────────────────────

/** Founder signature line (DESIGN §2.1). */
export const CERT_SIGNATURE = {
  en: 'Rajkumar Rajagobalan, Facilitator',
  ja: 'ラジクマール・ラジャゴバラン（ファシリテーター）',
} as const;

export interface CertificatePdfData {
  participantName: string;
  workshopTitle: BilingualText;
  startsAt: Date;
  endsAt: Date;
  issuedAt: Date;
  verifyCode: string;
}

/** Best display name from the user's `name` JSON (display → given+family → email). */
function displayName(name: unknown, email: string): string {
  const n = (name ?? {}) as { display?: string; given?: string; family?: string };
  if (n.display?.trim()) return n.display.trim();
  const parts = [n.family, n.given].filter((p): p is string => Boolean(p?.trim()));
  if (parts.length) return parts.join(' ');
  return email;
}

/**
 * Load a certificate into the flat shape the PDF needs, by enrollmentId. `tx` may
 * be tenant-scoped (RLS applies — the owner of the enrollment, or staff) or the
 * base client for owner/staff routes.
 */
export async function loadCertificatePdfData(
  tx: Prisma.TransactionClient,
  enrollmentId: string,
): Promise<CertificatePdfData> {
  const enrollment = await tx.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: { select: { name: true, email: true } },
      cohort: { include: { workshop: { select: { title: true } } } },
      certificate: true,
    },
  });
  if (!enrollment) throw new NotFoundError('Enrollment', enrollmentId);
  if (!enrollment.certificate) {
    throw new InvalidStateError('No certificate issued for this enrollment');
  }

  return {
    participantName: displayName(enrollment.user.name, enrollment.user.email),
    workshopTitle: enrollment.cohort.workshop.title as BilingualText,
    startsAt: enrollment.cohort.startsAt,
    endsAt: enrollment.cohort.endsAt,
    issuedAt: enrollment.certificate.issuedAt,
    verifyCode: enrollment.certificate.verifyCode,
  };
}

const s = StyleSheet.create({
  page: {
    fontFamily: JP_FONT,
    fontSize: 12,
    padding: 56,
    color: '#1a1a1a',
    lineHeight: 1.6,
    textAlign: 'center',
  },
  brand: { fontSize: 10, color: '#666', marginBottom: 24 },
  certTitleEn: { fontSize: 24, marginBottom: 2 },
  certTitleJa: { fontSize: 18, color: '#333', marginBottom: 28 },
  presentedEn: { fontSize: 11, color: '#555' },
  presentedJa: { fontSize: 11, color: '#555', marginBottom: 6 },
  name: { fontSize: 26, marginTop: 4, marginBottom: 20 },
  forEn: { fontSize: 11, color: '#555', marginTop: 8 },
  workshopEn: { fontSize: 16, marginTop: 2 },
  workshopJa: { fontSize: 14, color: '#333', marginBottom: 16 },
  dates: { fontSize: 10, color: '#666', marginBottom: 4 },
  issued: { fontSize: 10, color: '#666', marginBottom: 32 },
  sigLine: {
    marginTop: 8,
    borderTopWidth: 0.75,
    borderTopColor: '#333',
    width: 260,
    marginHorizontal: 'auto',
    paddingTop: 6,
  },
  sigEn: { fontSize: 11 },
  sigJa: { fontSize: 10, color: '#444' },
  footer: {
    position: 'absolute',
    bottom: 36,
    left: 56,
    right: 56,
    fontSize: 8,
    color: '#888',
    textAlign: 'center',
  },
});

function CertificateDocument({ data, locale }: { data: CertificatePdfData; locale: 'en' | 'ja' }) {
  const dates = `${formatDate(data.startsAt, locale)} – ${formatDate(data.endsAt, locale)}`;
  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.brand}>WorkshopOS</Text>
        <Text style={s.certTitleEn}>Certificate of Completion</Text>
        <Text style={s.certTitleJa}>修了証</Text>

        <Text style={s.presentedEn}>This certifies that</Text>
        <Text style={s.presentedJa}>次の方が修了されたことを証します</Text>
        <Text style={s.name}>{data.participantName}</Text>

        <Text style={s.forEn}>has successfully completed / 下記のワークショップを修了しました</Text>
        <Text style={s.workshopEn}>{data.workshopTitle.en}</Text>
        <Text style={s.workshopJa}>{data.workshopTitle.ja}</Text>

        <Text style={s.dates}>
          {locale === 'ja' ? '開催期間' : 'Cohort'}: {dates}
        </Text>
        <Text style={s.issued}>
          {locale === 'ja' ? '発行日' : 'Issued'}: {formatDate(data.issuedAt, locale)}
        </Text>

        <View style={s.sigLine}>
          <Text style={s.sigEn}>{CERT_SIGNATURE.en}</Text>
          <Text style={s.sigJa}>{CERT_SIGNATURE.ja}</Text>
        </View>

        <Text style={s.footer}>Verify at /verify/{data.verifyCode} — WorkshopOS</Text>
      </Page>
    </Document>
  );
}

/** Render the bilingual certificate to a PDF Buffer (starts with %PDF). `locale`
 * selects the primary display language; both languages appear regardless. */
export async function renderCertificatePdf(
  data: CertificatePdfData,
  locale: 'en' | 'ja' = 'en',
): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<CertificateDocument data={data} locale={locale} />);
}
