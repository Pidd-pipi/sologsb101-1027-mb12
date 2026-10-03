/** 糖化步状态 */
export type MashStepState = '未开始' | '进行中' | '已完成';

/** 糖化升温步 */
export interface MashStep {
  id: string;
  /** 所属配方版本（recipes.id）；已完成的升温步永远绑定生成它的版本 */
  recipeId: string;
  /** 顺序 */
  seq: number;
  /** 温度 ℃ */
  tempC: number;
  /** 时长 min */
  minutes: number;
  /** 水量 L */
  waterL: number;
  /** 状态 */
  state: MashStepState;
  /** 复制到新版后是否等待酿酒师复核（仅未完成步会被复制） */
  needsReview: boolean;
  /** 复制到新版本时的来源行 id（首版为空；已完成步不复制） */
  sourceId?: string;
}

export const MASH_STATES: MashStepState[] = ['未开始', '进行中', '已完成'];

export function createEmptyMashStep(): Omit<MashStep, 'id' | 'seq'> {
  return { recipeId: '', tempC: 66, minutes: 60, waterL: 16, state: '未开始', needsReview: false, sourceId: '' };
}
