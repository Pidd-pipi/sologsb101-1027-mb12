/** 发酵阶段 */
export type FermentState = '主发酵' | '双乙酰还原' | '已结束';

/** 发酵读数 */
export interface Ferment {
  id: string;
  /** 批次号 */
  batchNo: string;
  /** 所属配方（历史实绩绑定的具体版本行 recipes.id） */
  recipeId: string;
  /** 所属配方系列：配方改版后读数仍归同一款酒，不被新版改写 */
  seriesId: string;
  /** 投产时使用的配方版本号（留痕，展示用） */
  recipeVersionNo: number;
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 比重 */
  gravity: number;
  /** 温度 ℃ */
  tempC: number;
  /** 双乙酰 ppm */
  diacetylPpm: number;
  /** 阶段 */
  state: FermentState;
}

export const FERMENT_STATES: FermentState[] = ['主发酵', '双乙酰还原', '已结束'];
/** 双乙酰还原完成阈值 ppm */
export const DIACETYL_THRESHOLD = 0.1;
/** 发酵超温阈值 ℃ */
export const FERMENT_OVER_TEMP_C = 24;

export function createEmptyFerment(): Omit<Ferment, 'id'> {
  return {
    batchNo: '',
    recipeId: '',
    seriesId: '',
    recipeVersionNo: 1,
    date: new Date().toISOString().slice(0, 10),
    gravity: 1.05,
    tempC: 19,
    diacetylPpm: 0.4,
    state: '主发酵'
  };
}
