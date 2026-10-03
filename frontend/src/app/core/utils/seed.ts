/**
 * 首次打开应用时灌入的演示数据
 * 只在 recipes 表为空时执行。配方版本 → 麦芽 / 酒花 / 糖化步 / 煮沸投加 → 发酵读数 → 罐装批次
 * 三层互相引用，保证 6 个页面第一次进入都有内容。函数本身幂等：由调用方判定表是否为空。
 * 演示了三种版本状态：rc-001 / rc-002 为正式投产版；rc-003 已有停用的 v1 与待复核的 v2，
 * v2 的待执行糖化步与煮沸投加均带 needsReview 复核标记。
 */
import type { RecipeRow, MaltRow, HopRow, MashStepRow, BoilAddRow, FermentRow, PackagingRow } from './db';
import { db, ROW_REVISION } from './db';

function rev<T>(row: T): T & { revision: number; createdAt: number; updatedAt: number } {
  const now = Date.now();
  return { ...row, revision: ROW_REVISION, createdAt: now, updatedAt: now };
}

const RECIPES: Array<Omit<RecipeRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  {
    id: 'rc-001', seriesId: 'rc-001', versionNo: 1, status: '正式投产',
    name: '云顶西海岸 IPA', style: 'IPA', targetOg: 1.062, targetFg: 1.012, targetIbu: 62, targetEbc: 14, batchSizeL: 20,
    planPrimaryTempC: 19, planDiacetylTempC: 21, planDays: 14, planNeedsReview: false
  },
  {
    id: 'rc-002', seriesId: 'rc-002', versionNo: 1, status: '正式投产',
    name: '小麦白啤 Hefe', style: '小麦', targetOg: 1.05, targetFg: 1.011, targetIbu: 18, targetEbc: 8, batchSizeL: 25,
    planPrimaryTempC: 18, planDiacetylTempC: 20, planDays: 12, planNeedsReview: false
  },
  {
    id: 'rc-003', seriesId: 'rc-003', versionNo: 1, status: '已停用',
    name: '燕麦世涛', style: '世涛', targetOg: 1.068, targetFg: 1.018, targetIbu: 38, targetEbc: 58, batchSizeL: 18,
    planPrimaryTempC: 18, planDiacetylTempC: 20, planDays: 16, planNeedsReview: false
  },
  {
    id: 'rc-004', seriesId: 'rc-003', versionNo: 2, status: '待复核',
    name: '燕麦世涛', style: '世涛', targetOg: 1.072, targetFg: 1.018, targetIbu: 42, targetEbc: 62, batchSizeL: 20,
    planPrimaryTempC: 18, planDiacetylTempC: 20, planDays: 16, planNeedsReview: true
  }
];

const MALTS: Array<Omit<MaltRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'mt-001', recipeId: 'rc-001', name: '皮尔森麦芽', ebc: 4, origin: '德国', ratioPct: 82, type: '基础麦芽' },
  { id: 'mt-002', recipeId: 'rc-001', name: '慕尼黑麦芽', ebc: 22, origin: '德国', ratioPct: 12, type: '特种麦芽' },
  { id: 'mt-003', recipeId: 'rc-001', name: '焦香水晶麦芽', ebc: 60, origin: '英国', ratioPct: 6, type: '烤制麦芽' },
  { id: 'mt-004', recipeId: 'rc-002', name: '小麦麦芽', ebc: 5, origin: '德国', ratioPct: 55, type: '基础麦芽' },
  { id: 'mt-005', recipeId: 'rc-002', name: '皮尔森麦芽', ebc: 4, origin: '德国', ratioPct: 45, type: '基础麦芽' },
  { id: 'mt-006', recipeId: 'rc-003', name: '马里斯奥特麦芽', ebc: 6, origin: '英国', ratioPct: 70, type: '基础麦芽' },
  { id: 'mt-007', recipeId: 'rc-003', name: '烘烤大麦', ebc: 1200, origin: '英国', ratioPct: 10, type: '烤制麦芽' },
  // v2 待复核版复制的原料配比（配方页可继续调整）
  { id: 'mt-008', recipeId: 'rc-004', name: '马里斯奥特麦芽', ebc: 6, origin: '英国', ratioPct: 66, type: '基础麦芽' },
  { id: 'mt-009', recipeId: 'rc-004', name: '燕麦麦芽', ebc: 8, origin: '英国', ratioPct: 14, type: '特种麦芽' },
  { id: 'mt-010', recipeId: 'rc-004', name: '烘烤大麦', ebc: 1200, origin: '英国', ratioPct: 10, type: '烤制麦芽' }
];

const HOPS: Array<Omit<HopRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'hp-001', recipeId: 'rc-001', name: 'Centennial', alphaPct: 10.5, origin: '美国', form: '颗粒', amountG: 40 },
  { id: 'hp-002', recipeId: 'rc-001', name: 'Citra', alphaPct: 12.8, origin: '美国', form: '颗粒', amountG: 30 },
  { id: 'hp-003', recipeId: 'rc-002', name: 'Hallertau', alphaPct: 4.2, origin: '德国', form: '整花', amountG: 25 },
  { id: 'hp-004', recipeId: 'rc-003', name: 'East Kent Goldings', alphaPct: 5.6, origin: '英国', form: '颗粒', amountG: 45 },
  { id: 'hp-005', recipeId: 'rc-004', name: 'East Kent Goldings', alphaPct: 5.6, origin: '英国', form: '颗粒', amountG: 50 },
  { id: 'hp-006', recipeId: 'rc-004', name: 'Northern Brewer', alphaPct: 8.2, origin: '德国', form: '颗粒', amountG: 20 }
];

const MASH_STEPS: Array<Omit<MashStepRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'ms-001', recipeId: 'rc-001', seq: 1, tempC: 52, minutes: 15, waterL: 14, state: '已完成', needsReview: false },
  { id: 'ms-002', recipeId: 'rc-001', seq: 2, tempC: 66, minutes: 60, waterL: 16, state: '已完成', needsReview: false },
  { id: 'ms-003', recipeId: 'rc-001', seq: 3, tempC: 76, minutes: 10, waterL: 18, state: '已完成', needsReview: false },
  { id: 'ms-004', recipeId: 'rc-002', seq: 1, tempC: 45, minutes: 20, waterL: 15, state: '已完成', needsReview: false },
  { id: 'ms-005', recipeId: 'rc-002', seq: 2, tempC: 67, minutes: 50, waterL: 18, state: '进行中', needsReview: false },
  // rc-003 v1（已停用）：实绩工序全部完成，永远绑定原版本
  { id: 'ms-006', recipeId: 'rc-003', seq: 1, tempC: 68, minutes: 75, waterL: 20, state: '已完成', needsReview: false },
  // rc-004 v2（待复核）：从 v1 复制的待执行糖化步，等待复核
  { id: 'ms-007', recipeId: 'rc-004', seq: 1, tempC: 50, minutes: 15, waterL: 16, state: '未开始', needsReview: true },
  { id: 'ms-008', recipeId: 'rc-004', seq: 2, tempC: 67, minutes: 70, waterL: 20, state: '未开始', needsReview: true },
  { id: 'ms-009', recipeId: 'rc-004', seq: 3, tempC: 77, minutes: 10, waterL: 22, state: '未开始', needsReview: true }
];

const BOIL_ADDS: Array<Omit<BoilAddRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'ba-001', recipeId: 'rc-001', atMin: 60, material: 'Centennial', amountG: 25, purpose: '苦味', needsReview: false },
  { id: 'ba-002', recipeId: 'rc-001', atMin: 15, material: 'Centennial', amountG: 15, purpose: '风味', needsReview: false },
  { id: 'ba-003', recipeId: 'rc-001', atMin: 5, material: 'Citra', amountG: 30, purpose: '香气', needsReview: false },
  { id: 'ba-004', recipeId: 'rc-002', atMin: 60, material: 'Hallertau', amountG: 15, purpose: '苦味', needsReview: false },
  { id: 'ba-005', recipeId: 'rc-002', atMin: 10, material: 'Hallertau', amountG: 10, purpose: '香气', needsReview: false },
  { id: 'ba-006', recipeId: 'rc-003', atMin: 60, material: 'East Kent Goldings', amountG: 30, purpose: '苦味', needsReview: false },
  { id: 'ba-007', recipeId: 'rc-003', atMin: 15, material: '爱尔兰苔藓', amountG: 5, purpose: '澄清', needsReview: false },
  // rc-004 v2（待复核）：复制到新版的投加计划，等待复核
  { id: 'ba-008', recipeId: 'rc-004', atMin: 60, material: 'Northern Brewer', amountG: 20, purpose: '苦味', needsReview: true },
  { id: 'ba-009', recipeId: 'rc-004', atMin: 15, material: 'East Kent Goldings', amountG: 20, purpose: '风味', needsReview: true },
  { id: 'ba-010', recipeId: 'rc-004', atMin: 5, material: 'East Kent Goldings', amountG: 15, purpose: '香气', needsReview: true }
];

const FERMENTS: Array<Omit<FermentRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'fm-001', batchNo: 'B-2401', recipeId: 'rc-001', seriesId: 'rc-001', recipeVersionNo: 1, date: '2024-04-06', gravity: 1.062, tempC: 19.5, diacetylPpm: 0.62, state: '主发酵' },
  { id: 'fm-002', batchNo: 'B-2401', recipeId: 'rc-001', seriesId: 'rc-001', recipeVersionNo: 1, date: '2024-04-10', gravity: 1.028, tempC: 21.4, diacetylPpm: 0.38, state: '主发酵' },
  { id: 'fm-003', batchNo: 'B-2401', recipeId: 'rc-001', seriesId: 'rc-001', recipeVersionNo: 1, date: '2024-04-14', gravity: 1.014, tempC: 25.6, diacetylPpm: 0.16, state: '双乙酰还原' },
  { id: 'fm-004', batchNo: 'B-2401', recipeId: 'rc-001', seriesId: 'rc-001', recipeVersionNo: 1, date: '2024-04-18', gravity: 1.011, tempC: 22.1, diacetylPpm: 0.05, state: '已结束' },
  // rc-002 仍在制：切新版投产时必须提示这批仍引用 v1
  { id: 'fm-005', batchNo: 'B-2402', recipeId: 'rc-002', seriesId: 'rc-002', recipeVersionNo: 1, date: '2024-04-12', gravity: 1.05, tempC: 18.2, diacetylPpm: 0.5, state: '主发酵' },
  { id: 'fm-006', batchNo: 'B-2402', recipeId: 'rc-002', seriesId: 'rc-002', recipeVersionNo: 1, date: '2024-04-17', gravity: 1.016, tempC: 20.8, diacetylPpm: 0.22, state: '双乙酰还原' },
  // rc-003 v1 的历史实绩：已结束并罐装，改版后继续绑定 v1
  { id: 'fm-007', batchNo: 'B-2399', recipeId: 'rc-003', seriesId: 'rc-003', recipeVersionNo: 1, date: '2024-03-30', gravity: 1.068, tempC: 18.8, diacetylPpm: 0.7, state: '已结束' },
  { id: 'fm-008', batchNo: 'B-2399', recipeId: 'rc-003', seriesId: 'rc-003', recipeVersionNo: 1, date: '2024-04-08', gravity: 1.017, tempC: 20.1, diacetylPpm: 0.06, state: '已结束' }
];

const PACKAGINGS: Array<Omit<PackagingRow, 'revision' | 'createdAt' | 'updatedAt'>> = [
  { id: 'pk-001', batchNo: 'B-2401', recipeId: 'rc-001', seriesId: 'rc-001', recipeVersionNo: 1, packDate: '2024-04-22', container: '瓶装', quantity: 40, carbonationVol: 2.5, abv: 6.7 },
  { id: 'pk-002', batchNo: 'B-2399', recipeId: 'rc-003', seriesId: 'rc-003', recipeVersionNo: 1, packDate: '2024-04-12', container: '罐装', quantity: 48, carbonationVol: 2.2, abv: 6.7 }
];

/** 灌入演示数据（配方版本 → 麦芽 / 酒花 / 糖化步 / 煮沸投加 → 发酵读数 → 罐装批次） */
export async function seedDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds, db.ferments, db.packagings],
    async () => {
      await db.recipes.bulkPut(RECIPES.map(rev));
      await db.malts.bulkPut(MALTS.map(rev));
      await db.hops.bulkPut(HOPS.map(rev));
      await db.mashSteps.bulkPut(MASH_STEPS.map(rev));
      await db.boilAdds.bulkPut(BOIL_ADDS.map(rev));
      await db.ferments.bulkPut(FERMENTS.map(rev));
      await db.packagings.bulkPut(PACKAGINGS.map(rev));
    }
  );
}
