/**
 * LABELS - FROZEN CONTRACT.
 * Istilah industri yang WAJIB dipakai apa adanya (parity checklist 05 §3C:
 * "Istilah sama - jangan diganti dengan sinonim").
 */

export const REPORT_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  distributed: 'Distributed',
  locked: 'Locked',
};

export const TIME_CLASS_LABEL: Record<string, string> = {
  PRD: 'Productive',
  NPT: 'NPT - Unscheduled',
  WOW: 'Wait on Weather',
  FM: 'Force Majeure',
  STBY: 'Standby',
  DSPT: 'Disputed',
  GAP: 'Unallocated Gap',
};

export const WELL_PHASE_LABEL: Record<string, string> = {
  planning: 'Planning',
  drilling: 'Drilling',
  completion: 'Completion',
  workover: 'Workover / Intervention',
  fracking: 'Fracking',
  flowback: 'Flowback',
  facility: 'Facilities',
  closed: 'Closed',
};

export const RIG_TYPE_LABEL: Record<string, string> = {
  land: 'Land Rig',
  jackup: 'Jackup',
  anchored_floater: 'Anchored Floater',
  dpp_floater: 'DPP Floater',
};

export const WELL_TYPE_LABEL: Record<string, string> = {
  oil: 'Oil',
  gas: 'Gas',
  geothermal: 'Geothermal',
  ccs: 'CCS',
  mining: 'Mining',
  water: 'Water Well',
};

/** Kategori biaya standar (dipakai di form cost & dashboard). */
export const COST_CATEGORIES = [
  'Rig Spread',
  'Mud & Chems',
  'Fuel & Power',
  'Directional / RSS',
  'NPT Repair & Tech',
  'Standby Adjust.',
  'Waste & Solids',
  'Mud Logging',
  'Cementing',
  'Logging',
  'Tubulars',
  'Other',
] as const;

export const MARINE_VARIANTS = ['jackup', 'anchored_floater', 'dpp_floater'] as const;
export type MarineVariant = (typeof MARINE_VARIANTS)[number];
