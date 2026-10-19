/**
 * Helper kecil untuk route laporan: normalisasi payload zod → argumen repo.
 *
 * Kenapa ada: field ber-`.default()` di `@rigdaily/shared` (mis. `zCrewRow.position`)
 * tetap bertipe `T | undefined` pada tipe hasil parse, sehingga mapping eksplisit
 * dengan fallback mencegah `undefined` bocor ke kolom DB `NOT NULL`.
 */
import type { z } from 'zod';
import type { zCrewRow } from '@rigdaily/shared';

/** Payload crew hasil parse (bentuk input zod). */
export type CrewInput = z.input<typeof zCrewRow>;

export type CrewRepoRow = {
  name: string;
  position: string;
  company: string | null;
  shift: string;
  hours: number;
  pobStatus: string;
  musterStation: string | null;
};

/** Crew payload → baris repo (fallback mengikuti default schema shared). */
export function toCrewRepoRows(crew: CrewInput[] | undefined): CrewRepoRow[] {
  if (!crew) return [];
  return crew.map((c) => ({
    name: c.name,
    position: c.position?.trim() || 'Crew',
    company: c.company ?? null,
    shift: c.shift || 'Day',
    hours: c.hours ?? 12,
    pobStatus: c.pobStatus || 'in',
    musterStation: c.musterStation ?? null,
  }));
}
