import { Gamemode, TesterCertificationLevel, TierName } from "@prisma/client";

export const GAMEMODE_DEFINITIONS = [
  { key: Gamemode.SWORD, label: "Sword", sortOrder: 1 },
  { key: Gamemode.AXE, label: "Axe", sortOrder: 2 },
  { key: Gamemode.NETHPOT, label: "NethPot", sortOrder: 3 },
  { key: Gamemode.DIAPOT, label: "DiaPot", sortOrder: 4 },
  { key: Gamemode.SMP, label: "SMP", sortOrder: 5 },
  { key: Gamemode.UHC, label: "UHC", sortOrder: 6 },
  { key: Gamemode.CRYSTAL, label: "Crystal", sortOrder: 7 },
  { key: Gamemode.MACE, label: "Mace", sortOrder: 8 },
  { key: Gamemode.SPEARMACE, label: "SpearMace", sortOrder: 9 }
] as const;

export const TIER_DEFINITIONS = [
  { key: TierName.LT5, label: "LT5", sortOrder: 1 },
  { key: TierName.HT5, label: "HT5", sortOrder: 2 },
  { key: TierName.LT4, label: "LT4", sortOrder: 3 },
  { key: TierName.HT4, label: "HT4", sortOrder: 4 },
  { key: TierName.LT3, label: "LT3", sortOrder: 5 },
  { key: TierName.HT3, label: "HT3", sortOrder: 6 },
  { key: TierName.LT2, label: "LT2", sortOrder: 7 },
  { key: TierName.HT2, label: "HT2", sortOrder: 8 },
  { key: TierName.LT1, label: "LT1", sortOrder: 9 },
  { key: TierName.HT1, label: "HT1", sortOrder: 10 }
] as const;

export const TESTER_CERTIFICATION_LEVELS = [
  TesterCertificationLevel.NONE,
  TesterCertificationLevel.LOWER,
  TesterCertificationLevel.MIDDLE,
  TesterCertificationLevel.HIGHER
] as const;

export const STAFF_ROLE_OPTION_LABELS = {
  owner_role: "ownerRoleId",
  administrator_role: "administratorRoleId",
  tier_manager_role: "tierManagerRoleId",
  head_tester_role: "headTesterRoleId",
  senior_tester_role: "seniorTesterRoleId",
  tester_role: "testerRoleId",
  trial_tester_role: "trialTesterRoleId"
} as const;

export const CHANNEL_OPTION_LABELS = {
  queue_channel: "queueChannelId",
  results_channel: "resultsChannelId",
  logs_channel: "logsChannelId",
  review_channel: "reviewChannelId",
  test_category: "testCategoryId"
} as const;

export const QUEUE_REGIONS = ["AS", "ME"] as const;

export type QueueRegionLabel = (typeof QUEUE_REGIONS)[number];

export type StaffRoleConfigKey = (typeof STAFF_ROLE_OPTION_LABELS)[keyof typeof STAFF_ROLE_OPTION_LABELS];
export type ChannelConfigKey = (typeof CHANNEL_OPTION_LABELS)[keyof typeof CHANNEL_OPTION_LABELS];

export function formatTierRoleName(gamemodeLabel: string, tierLabel: string): string {
  return `${gamemodeLabel} • ${tierLabel}`;
}

export function formatWhitelistRoleName(gamemodeLabel: string, region: QueueRegionLabel): string {
  return `${gamemodeLabel} • Whitelist ${region}`;
}
