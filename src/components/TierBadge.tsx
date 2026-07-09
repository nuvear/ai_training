import type { AiTier } from '@/generated/prisma';

// Tier badge (DESIGN §7): auto = 藍白 tint, approve = 黄金鈍 tint, owner = 朱 tint.
// Presentational — the caller passes the already-localized tier word as `label`.
const CLASS: Record<AiTier, string> = {
  auto: 'auto',
  approve: 'approve',
  owner_only: 'owner',
};

export function TierBadge({ tier, label }: { tier: AiTier; label: string }) {
  return <span className={`badge ${CLASS[tier]}`}>{label}</span>;
}
