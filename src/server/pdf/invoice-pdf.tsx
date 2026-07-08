import 'server-only';
import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import type { Prisma } from '@/generated/prisma';
import { NotFoundError } from '@/server/domain/errors';
import { formatJpy, formatUsd, formatDate } from '@/lib/format';
import { ensureFonts, JP_FONT } from './fonts';

// ─────────────────────────────────────────────────────────────────────────────
// Bilingual 請求書 (invoice) PDF, rendered ON DEMAND (no object storage). Money is
// read straight from the Order (computed server-side at checkout — never
// recomputed here): subtotal / 10% consumption tax / total. Latin numerals, ¥
// formatting. The 適格請求書 registration number comes from
// process.env.QUALIFIED_INVOICE_NO and is omitted when blank.
// ─────────────────────────────────────────────────────────────────────────────

export interface InvoicePdfData {
  number: string;
  qualifiedInvoiceNo: string | null;
  orgName: { en: string; ja: string };
  dueAt: Date;
  createdAt: Date;
  currency: 'JPY' | 'USD';
  subtotal: number;
  tax: number;
  total: number;
  items: Array<{ label: { en: string; ja: string }; qty: number; unitPrice: number }>;
}

function money(currency: 'JPY' | 'USD', minor: number, locale: 'en' | 'ja'): string {
  return currency === 'JPY' ? formatJpy(minor, locale) : formatUsd(minor);
}

/** Load an invoice into the flat shape the PDF needs. `tx` may be a tenant-scoped
 * client (RLS applies) or the base client for owner/staff. */
export async function loadInvoicePdfData(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<InvoicePdfData> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      organization: true,
      order: { include: { items: { include: { cohort: { include: { workshop: true } } } } } },
    },
  });
  if (!invoice) throw new NotFoundError('Invoice', invoiceId);

  const orgName = invoice.organization.name as { en?: string; ja?: string };
  const order = invoice.order;

  const items = order.items.map((it) => {
    const workshop = it.cohort?.workshop;
    const title = (workshop?.title as { en?: string; ja?: string } | undefined) ?? undefined;
    const spec = it.seatPoolSpec as { seats?: number } | null;
    const label =
      title?.en || title?.ja
        ? { en: title?.en ?? title?.ja ?? '', ja: title?.ja ?? title?.en ?? '' }
        : spec?.seats
          ? { en: `Seat pool (${spec.seats} seats)`, ja: `シートプール（${spec.seats}席）` }
          : { en: 'Workshop enrollment', ja: 'ワークショップ受講' };
    return { label, qty: it.qty, unitPrice: it.unitPrice };
  });

  return {
    number: invoice.number,
    qualifiedInvoiceNo: invoice.qualifiedInvoiceNo,
    orgName: { en: orgName.en ?? orgName.ja ?? '', ja: orgName.ja ?? orgName.en ?? '' },
    dueAt: invoice.dueAt,
    createdAt: invoice.createdAt,
    currency: order.currency,
    subtotal: order.subtotal,
    tax: order.tax,
    total: order.total,
    items,
  };
}

const s = StyleSheet.create({
  page: { fontFamily: JP_FONT, fontSize: 10, padding: 44, color: '#1a1a1a', lineHeight: 1.5 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  titleJa: { fontSize: 22 },
  titleEn: { fontSize: 11, color: '#555' },
  issuer: { textAlign: 'right', fontSize: 9, color: '#333' },
  meta: { marginBottom: 16 },
  metaLine: { flexDirection: 'row', marginBottom: 2 },
  metaLabel: { width: 150, color: '#555' },
  section: { marginBottom: 16 },
  th: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#333',
    paddingBottom: 4,
    marginBottom: 4,
  },
  tr: { flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.5, borderColor: '#ddd' },
  cDesc: { flex: 4 },
  cQty: { flex: 1, textAlign: 'right' },
  cUnit: { flex: 2, textAlign: 'right' },
  cAmt: { flex: 2, textAlign: 'right' },
  totals: { marginTop: 12, alignSelf: 'flex-end', width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grand: { borderTopWidth: 1, borderColor: '#333', marginTop: 4, paddingTop: 4, fontSize: 12 },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 44,
    right: 44,
    fontSize: 8,
    color: '#888',
    textAlign: 'center',
  },
});

function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  const loc = 'ja';
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.titleJa}>請求書</Text>
            <Text style={s.titleEn}>INVOICE</Text>
          </View>
          <View style={s.issuer}>
            <Text>WorkshopOS</Text>
            <Text>Rajkumar Rajagobalan</Text>
            <Text>ラジクマール・ラジャゴバラン</Text>
          </View>
        </View>

        <View style={s.meta}>
          <View style={s.metaLine}>
            <Text style={s.metaLabel}>請求書番号 / Invoice No.</Text>
            <Text>{data.number}</Text>
          </View>
          {data.qualifiedInvoiceNo ? (
            <View style={s.metaLine}>
              <Text style={s.metaLabel}>登録番号 / Registration No.</Text>
              <Text>{data.qualifiedInvoiceNo}</Text>
            </View>
          ) : null}
          <View style={s.metaLine}>
            <Text style={s.metaLabel}>請求先 / Bill to</Text>
            <Text>
              {data.orgName.ja} / {data.orgName.en}
            </Text>
          </View>
          <View style={s.metaLine}>
            <Text style={s.metaLabel}>発行日 / Issued</Text>
            <Text>
              {formatDate(data.createdAt, 'ja')} / {formatDate(data.createdAt, 'en')}
            </Text>
          </View>
          <View style={s.metaLine}>
            <Text style={s.metaLabel}>お支払期限 / Due</Text>
            <Text>
              {formatDate(data.dueAt, 'ja')} / {formatDate(data.dueAt, 'en')}
            </Text>
          </View>
        </View>

        <View style={s.section}>
          <View style={s.th}>
            <Text style={s.cDesc}>項目 / Description</Text>
            <Text style={s.cQty}>数量 / Qty</Text>
            <Text style={s.cUnit}>単価 / Unit</Text>
            <Text style={s.cAmt}>金額 / Amount</Text>
          </View>
          {data.items.map((it, idx) => (
            <View style={s.tr} key={idx}>
              <Text style={s.cDesc}>
                {it.label.ja} / {it.label.en}
              </Text>
              <Text style={s.cQty}>{it.qty}</Text>
              <Text style={s.cUnit}>{money(data.currency, it.unitPrice, loc)}</Text>
              <Text style={s.cAmt}>{money(data.currency, it.unitPrice * it.qty, loc)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text>小計 / Subtotal</Text>
            <Text>{money(data.currency, data.subtotal, loc)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text>消費税 10% / Tax</Text>
            <Text>{money(data.currency, data.tax, loc)}</Text>
          </View>
          <View style={[s.totalRow, s.grand]}>
            <Text>合計 / Total</Text>
            <Text>{money(data.currency, data.total, loc)}</Text>
          </View>
        </View>

        <Text style={s.footer}>
          WorkshopOS — Rajkumar Rajagobalan / ラジクマール・ラジャゴバラン
        </Text>
      </Page>
    </Document>
  );
}

/** Render the bilingual invoice PDF to a Buffer (starts with %PDF). */
export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<InvoiceDocument data={data} />);
}
