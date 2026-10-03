/** 啤酒风格 */
export type BeerStyle = 'IPA' | '小麦' | '世涛' | '拉格' | '酸啤';

/** 配方版本状态：待复核的新版草稿 / 正式投产版本 / 已被新版替代的停用版本 */
export type RecipeVersionStatus = '待复核' | '正式投产' | '已停用';

/** 配方：糖化与发酵的顶层工艺定义（每个版本一行，历史版本不可变） */
export interface Recipe {
  id: string;
  /** 配方系列 id：同一款酒的所有版本共享，等于首个版本（v1）的行 id */
  seriesId: string;
  /** 系列内版本号，从 1 递增 */
  versionNo: number;
  /** 版本状态 */
  status: RecipeVersionStatus;
  /** 配方名称（系列内各版本共用名称；改名不改工艺时在当前投产版上原地改） */
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
  /** 发酵计划：主发酵温度 ℃（随版本复制，新版待复核） */
  planPrimaryTempC: number;
  /** 发酵计划：双乙酰还原温度 ℃ */
  planDiacetylTempC: number;
  /** 发酵计划：计划发酵天数 */
  planDays: number;
  /** 复制到新版的发酵计划是否等待复核（v1 为 false，fork 出的新版为 true） */
  planNeedsReview: boolean;
}

export const BEER_STYLES: BeerStyle[] = ['IPA', '小麦', '世涛', '拉格', '酸啤'];
export const RECIPE_VERSION_STATUSES: RecipeVersionStatus[] = ['待复核', '正式投产', '已停用'];

/** 配方表单字段（保存时按这些字段判断是否需要生成新版本） */
export type RecipeFormValues = Omit<Recipe, 'id' | 'seriesId' | 'versionNo' | 'status'>;

export function createEmptyRecipe(): RecipeFormValues {
  return {
    name: '',
    style: 'IPA',
    targetOg: 1.06,
    targetFg: 1.012,
    targetIbu: 45,
    targetEbc: 12,
    batchSizeL: 20,
    planPrimaryTempC: 19,
    planDiacetylTempC: 21,
    planDays: 14,
    planNeedsReview: false
  };
}
