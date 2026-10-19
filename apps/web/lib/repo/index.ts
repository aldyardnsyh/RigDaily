/**
 * Barrel - repository / data-access layer RigDaily. SERVER ONLY.
 *
 * Ini SATU-SATUNYA pintu query Drizzle untuk route handler & server component.
 * Route handler JANGAN import `db`/`schema` langsung.
 *
 * Pemakaian (server):
 *   import { listReports, getReportById, writeAudit } from '@/lib/repo';
 *
 * Pemakaian (client component) - tipe saja:
 *   import type { ReportDetail } from '@/lib/repo/types';
 *   ⚠️ JANGAN import '@/lib/repo' dari client component: modul server memakai
 *   `server-only` dan akan gagal di-build.
 */

/* Tipe DTO (pure, bisa dipakai client lewat '@/lib/repo/types'). */
export type * from './types';

/* Reports (DDR) */
export {
  createAmendment,
  createReport,
  getPreviousReport,
  getReportByWellAndDate,
  getReportById,
  listBha,
  listReports,
  nextReportNo,
  replaceBha,
  replaceCostLines,
  replaceCrew,
  replaceTimeRows,
  updateReportHeader,
  updateReportStatus,
  upsertMud,
} from './reports';

/* Wells */
export {
  countReportsForWell,
  createWell,
  getWellById,
  getWellByName,
  getWellMilestones,
  listWells,
  softDeleteWell,
  updateWell,
  updateWellDetails,
} from './wells';
export type { WellCreateInput } from './wells';

/* Rigs */
export {
  countRigUsage,
  createRig,
  getRigById,
  listRigs,
  softDeleteRig,
  updateRig,
} from './rigs';
export type { RigCreateInput, RigPatchInput } from './rigs';

/* Costs */
export { addCostLine, deleteCostLine, getCostSummary, listCostLines } from './costs';

/* Billing */
export {
  deleteBillingFlag,
  getBillingFlags,
  getMonthlyBilling,
  listRateCards,
  setBillingFlag,
} from './billing';
export type { BillingFlagDto } from './billing';

/* Master data */
export {
  countActiveAdmins,
  createDeviceApiKey,
  createDistributionRule,
  createUser,
  getSystemOverview,
  getUserById,
  listDeliveryLog,
  listDistributionRules,
  listIadcCodes,
  listKpiDefinitions,
  listSyncDevices,
  listUsers,
  revokeAllUserSessions,
  rotateDeviceApiKey,
  setDeviceActive,
  softDeleteDevice,
  softDeleteDistributionRule,
  softDeleteUser,
  updateDistributionRule,
  updateIadcCode,
  updateUser,
} from './master';
export type { DistributionRulePatch, IadcCodePatch, UserPatch } from './master';

/* Operasional per-DDR (marine, MAC, survey, insiden, rate card, KPI) */
export {
  createIncident,
  createKpiDefinition,
  getKpiDefinitionById,
  getMarine,
  getRateCardById,
  INCIDENT_REF_PREFIX,
  listIncidents,
  listKpiDefinitionsDetailed,
  listMac,
  listRateCardsDetailed,
  listSurvey,
  MARINE_VARIANTS,
  nextIncidentRefNo,
  replaceMac,
  replaceSurvey,
  softDeleteIncident,
  softDeleteKpiDefinition,
  softDeleteRateCard,
  updateIncident,
  updateKpiDefinition,
  updateRateCard,
  upsertMarine,
  upsertRateCard,
} from './operations';
export type { IncidentItemDto, KpiDefinitionDetailedDto, MacItemDto, RateCardDetailedDto, RateTierDto, SurveyItemDto } from './operations';

/* Audit */
export { listAudit, writeAudit } from './audit';

/* Dashboard */
export { getDashboardKpi, getReportsSummary, getTimeMix, getTrend } from './dashboard';

/* Personnel / POB */
export { getPobSummary, listPersonnel, upsertPersonnel } from './personnel';
export type { PersonnelDto, PersonnelFilter, PobSummary } from './personnel';

/* Profil & sesi milik user yang login */
export {
  changePassword,
  getProfile,
  hashSessionToken,
  listSessions,
  PASSWORD_MIN_LENGTH,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
} from './profile';
export type { ProfileDto, SessionDto } from './profile';

/* Engineering per sumur: bit, desain casing, program semen */
export {
  createBit,
  createCementProgram,
  getBitSummary,
  listBits,
  listCasingDesign,
  listCementPrograms,
  nextBitNo,
  replaceCasingDesign,
  softDeleteBit,
  softDeleteCementProgram,
  updateBit,
  updateCementProgram,
} from './engineering';
export type {
  BitDto,
  BitInput,
  BitPatch,
  BitSummary,
  CasingDto,
  CasingItemInput,
  CementDto,
  CementInput,
  CementPatch,
} from './engineering';

/* Insights & benchmarking */
export { compareAgainstBaseline, getMetricTrend, getWellBenchmark, listKpiBaselines } from './insights';
export type {
  BaselineComparison,
  KpiBaseline,
  TrendMetric,
  TrendSeries,
  WellBenchmarkRow,
} from './insights';
