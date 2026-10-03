/**
 * 配方版本化相关的跨模型类型：并发冲突字段、投产影响评估、原料配比覆盖。
 * 被 RecipeVersionService 与 recipe feature 的 actions / reducer / effects 共同消费。
 */
import type { BeerStyle } from './recipe.model';

/** 并发冲突字段：旧窗口基于 base 版本，而 latest 版本已被其他窗口改动 */
export interface VersionConflictField {
  /** 字段键（style / targetOg / maltRatio …） */
  field: string;
  /** 字段中文名，用于弹窗展示 */
  label: string;
  /** 旧窗口所基于版本上的值 */
  baseValue: string;
  /** 最新版本上的值（即其他窗口已保存的改动） */
  latestValue: string;
}

/** 投产影响项：一个仍引用旧版的未结束批次 */
export interface VersionImpactBatch {
  /** 批次号 */
  batchNo: string;
  /** 批次当前阶段（主发酵 / 双乙酰还原） */
  state: string;
  /** 最近一次比重 */
  gravity: number;
  /** 最近一次读数日期 YYYY-MM-DD */
  date: string;
}

/** 切新版投产的影响评估 */
export interface VersionImpact {
  /** 仍引用旧版的未结束批次（真实读数，排除计划标记） */
  unfinishedBatches: VersionImpactBatch[];
  /** 已复制到新版、待复核的糖化步数量 */
  pendingMashStepCount: number;
  /** 已复制到新版、待复核的煮沸投加数量 */
  pendingBoilAddCount: number;
  /** 已复制到新版、待复核的发酵计划数量 */
  pendingPlanCount: number;
}

/** 创建新版本时随配方字段一起提交的原料配比覆盖（按原料行 id 索引） */
export interface VersionRatioOverrides {
  /** 麦芽行 id → 新的用量占比 % */
  maltRatios: Record<string, number>;
  /** 酒花行 id → 新的用量 g */
  hopAmounts: Record<string, number>;
}

/** 版本历史列表中的一行（只读快照） */
export interface VersionHistoryEntry {
  id: string;
  versionNo: number;
  versionState: string;
  baseVersionId: string | null;
  style: BeerStyle;
  targetOg: number;
  targetFg: number;
  targetIbu: number;
  targetEbc: number;
  batchSizeL: number;
  createdAt: number;
}
