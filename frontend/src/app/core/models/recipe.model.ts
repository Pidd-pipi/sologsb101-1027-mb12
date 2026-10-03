/** 啤酒风格 */
export type BeerStyle = 'IPA' | '小麦' | '世涛' | '拉格' | '酸啤';

/** 配方版本生命周期：生效中（当前投产）/ 待复核（新版草稿，待启用）/ 已归档（历史版本，只读） */
export type RecipeVersionState = '生效中' | '待复核' | '已归档';

/**
 * 配方（版本行）。正式配方按「家族 + 版本号」组织：
 * - 同一家族（familyId）下可有多个版本（versionNo 递增），每个版本不可变。
 * - 风格 / 目标指标 / 批次体积 / 原料配比变化时生成新版本，旧版本保留为历史实绩。
 * - baseVersionId 记录本版基于哪一版修改，用于乐观并发校验（两窗口同时改配方时，只接受基于最新版的保存）。
 */
export interface Recipe {
  id: string;
  /** 配方家族 id：同一正式配方的所有版本共用 */
  familyId: string;
  /** 版本号，从 1 递增 */
  versionNo: number;
  /** 本版基于哪一版修改（首版为 null），用于并发冲突校验 */
  baseVersionId: string | null;
  /** 版本生命周期状态 */
  versionState: RecipeVersionState;
  /** 配方名称 */
  name: string;
  /** 风格 */
  style: BeerStyle;
  /** 目标初始比重 OG */
  targetOg: number;
  /** 目标终点比重 FG */
  targetFg: number;
  /** 目标苦度 IBU */
  targetIbu: number;
  /** 目标色度 EBC */
  targetEbc: number;
  /** 批次体积 L */
  batchSizeL: number;
}

/** 版本驱动字段：改动这些字段即生成新版本（而非原地覆盖） */
export const VERSION_DRIVEN_FIELDS = ['style', 'targetOg', 'targetFg', 'targetIbu', 'targetEbc', 'batchSizeL'] as const;
export type VersionDrivenField = (typeof VERSION_DRIVEN_FIELDS)[number];

export const BEER_STYLES: BeerStyle[] = ['IPA', '小麦', '世涛', '拉格', '酸啤'];

/** 新建 / 编辑表单可填写的配方字段（版本号、家族等由版本服务在落库时补全） */
export type RecipeDraft = Pick<
  Recipe,
  'name' | 'style' | 'targetOg' | 'targetFg' | 'targetIbu' | 'targetEbc' | 'batchSizeL'
>;

export function createEmptyRecipe(): RecipeDraft {
  return { name: '', style: 'IPA', targetOg: 1.06, targetFg: 1.012, targetIbu: 45, targetEbc: 12, batchSizeL: 20 };
}
