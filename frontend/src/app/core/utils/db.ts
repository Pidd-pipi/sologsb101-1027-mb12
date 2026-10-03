/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据库名 gbbrewhouse-db，数据结构版本 version(2)
 * - v2：配方改为不可变版本行（seriesId / versionNo / status），糖化步与煮沸投加带 needsReview，
 *   发酵读数与罐装批次带 seriesId / recipeVersionNo，历史实绩继续绑定原版本
 * - 配方 / 麦芽 / 酒花 / 糖化步 / 煮沸投加 / 发酵读数 / 罐装批次 七张表分表存储
 * - 首次打开自动播种互相引用的演示数据，保证每个页面打开都有内容
 */
import Dexie, { type Table } from 'dexie';
import type { Recipe } from '../models/recipe.model';
import type { Malt } from '../models/malt.model';
import type { Hop } from '../models/hop.model';
import type { MashStep } from '../models/mash-step.model';
import type { BoilAdd } from '../models/boil-add.model';
import type { Ferment } from '../models/ferment.model';
import type { Packaging } from '../models/packaging.model';
import { nowIso } from './uuid';
import { seedDatabase } from './seed';

/** 数据库名 */
export const DB_NAME = 'gbbrewhouse-db';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 2;

/** 行结构修订号 */
export const ROW_REVISION = 2;

export interface Revisioned {
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export type RecipeRow = Recipe & Revisioned;
export type MaltRow = Malt & Revisioned;
export type HopRow = Hop & Revisioned;
export type MashStepRow = MashStep & Revisioned;
export type BoilAddRow = BoilAdd & Revisioned;
export type FermentRow = Ferment & Revisioned;
export type PackagingRow = Packaging & Revisioned;

class GbBrewhouseDatabase extends Dexie {
  recipes!: Table<RecipeRow, string>;
  malts!: Table<MaltRow, string>;
  hops!: Table<HopRow, string>;
  mashSteps!: Table<MashStepRow, string>;
  boilAdds!: Table<BoilAddRow, string>;
  ferments!: Table<FermentRow, string>;
  packagings!: Table<PackagingRow, string>;

  constructor() {
    super(DB_NAME);

    // v1：初始七表结构（保留声明以便老库逐级升级）
    this.version(1).stores({
      recipes: 'id, name, style, targetOg, updatedAt',
      malts: 'id, recipeId, name, ebc, type, updatedAt',
      hops: 'id, recipeId, name, alphaPct, form, updatedAt',
      mashSteps: 'id, recipeId, seq, state, updatedAt',
      boilAdds: 'id, recipeId, atMin, purpose, updatedAt',
      ferments: 'id, recipeId, batchNo, date, state, updatedAt',
      packagings: 'id, recipeId, batchNo, packDate, container, updatedAt'
    });

    // v2：配方不可变版本化
    this.version(2)
      .stores({
        recipes: 'id, seriesId, versionNo, status, name, style, targetOg, updatedAt',
        malts: 'id, recipeId, name, ebc, type, updatedAt',
        hops: 'id, recipeId, name, alphaPct, form, updatedAt',
        mashSteps: 'id, recipeId, seq, state, needsReview, updatedAt',
        boilAdds: 'id, recipeId, atMin, purpose, needsReview, updatedAt',
        ferments: 'id, recipeId, seriesId, batchNo, date, state, updatedAt',
        packagings: 'id, recipeId, seriesId, batchNo, packDate, container, updatedAt'
      })
      .upgrade(async (tx) => {
        // 历史配方全部视为 v1 正式投产版本：seriesId 取自身 id，版本不可变
        await tx
          .table('recipes')
          .toCollection()
          .modify((row: Record<string, unknown>) => {
            if (typeof row['seriesId'] !== 'string') row['seriesId'] = row['id'];
            if (typeof row['versionNo'] !== 'number') row['versionNo'] = 1;
            if (typeof row['status'] !== 'string') row['status'] = '正式投产';
            if (typeof row['planPrimaryTempC'] !== 'number') row['planPrimaryTempC'] = 19;
            if (typeof row['planDiacetylTempC'] !== 'number') row['planDiacetylTempC'] = 21;
            if (typeof row['planDays'] !== 'number') row['planDays'] = 14;
            if (typeof row['planNeedsReview'] !== 'boolean') row['planNeedsReview'] = false;
          });
        // 待执行工序复制到新版时的复核标记：老数据默认无需复核、无来源行
        for (const name of ['mashSteps', 'boilAdds', 'malts', 'hops']) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              if (typeof row['needsReview'] !== 'boolean') row['needsReview'] = false;
              if (typeof row['sourceId'] !== 'string') row['sourceId'] = '';
            });
        }
        // 历史实绩（发酵读数 / 罐装批次）继续绑定原版本，同时归入同一配方系列
        for (const name of ['ferments', 'packagings']) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: Record<string, unknown>) => {
              if (typeof row['seriesId'] !== 'string') row['seriesId'] = String(row['recipeId'] ?? '');
              if (typeof row['recipeVersionNo'] !== 'number') row['recipeVersionNo'] = 1;
            });
        }
      });
  }
}

export const db = new GbBrewhouseDatabase();

/** 初始化 Promise 缓存：并发调用共享同一次「打开 + 按需播种」，避免重复灌入演示数据 */
let initPromise: Promise<void> | null = null;

/** 打开数据库：首次使用时灌入演示数据（幂等：表非空不播；并发调用复用同一 Promise） */
export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await db.open();
      if ((await db.recipes.count()) === 0) {
        await seedDatabase();
      }
    })().catch((error: unknown) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

/* ------------------------------ 配方 ------------------------------ */

export async function listRecipes(): Promise<RecipeRow[]> {
  const rows = await db.recipes.toArray();
  return rows.sort((a, b) =>
    a.seriesId === b.seriesId
      ? a.versionNo - b.versionNo
      : a.name.localeCompare(b.name, 'zh-Hans-CN')
  );
}

/**
 * 删除配方：删除整个系列的全部版本，并级联删除各版本下的
 * 麦芽、酒花、糖化步、煮沸投加、发酵读数与罐装批次。
 */
export async function removeRecipe(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds, db.ferments, db.packagings],
    async () => {
      const target = await db.recipes.get(id);
      if (!target) return;
      const seriesIds = [target.seriesId];
      const versionIds = (await db.recipes.where('seriesId').anyOf(seriesIds).toArray()).map((row) => row.id);
      await db.malts.where('recipeId').anyOf(versionIds).delete();
      await db.hops.where('recipeId').anyOf(versionIds).delete();
      await db.mashSteps.where('recipeId').anyOf(versionIds).delete();
      await db.boilAdds.where('recipeId').anyOf(versionIds).delete();
      await db.ferments.where('seriesId').anyOf(seriesIds).delete();
      await db.packagings.where('seriesId').anyOf(seriesIds).delete();
      await db.recipes.where('seriesId').anyOf(seriesIds).delete();
    }
  );
}

/* --------------------------- 整库导入导出 --------------------------- */

export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  recipes: Recipe[];
  malts: Malt[];
  hops: Hop[];
  mashSteps: MashStep[];
  boilAdds: BoilAdd[];
  ferments: Ferment[];
  packagings: Packaging[];
}

function stripRow<T extends Revisioned>(row: T): Omit<T, keyof Revisioned> {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.revision;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as Omit<T, keyof Revisioned>;
}

export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [recipes, malts, hops, mashSteps, boilAdds, ferments, packagings] = await Promise.all([
    db.recipes.toArray(),
    db.malts.toArray(),
    db.hops.toArray(),
    db.mashSteps.toArray(),
    db.boilAdds.toArray(),
    db.ferments.toArray(),
    db.packagings.toArray()
  ]);
  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    recipes: recipes.map(stripRow),
    malts: malts.map(stripRow),
    hops: hops.map(stripRow),
    mashSteps: mashSteps.map(stripRow),
    boilAdds: boilAdds.map(stripRow),
    ferments: ferments.map(stripRow),
    packagings: packagings.map(stripRow)
  };
}

function stamp<T>(row: T): T & Revisioned {
  const now = Date.now();
  return { ...row, revision: ROW_REVISION, createdAt: now, updatedAt: now };
}

/** 补齐旧备份（v1 结构）缺失的版本化字段，保证导入老备份后语义不回退 */
function normalizeSnapshot(snapshot: DatabaseSnapshot): void {
  for (const recipe of snapshot.recipes) {
    if (!recipe.seriesId) recipe.seriesId = recipe.id;
    if (!recipe.versionNo) recipe.versionNo = 1;
    if (!recipe.status) recipe.status = '正式投产';
    if (typeof recipe.planPrimaryTempC !== 'number') recipe.planPrimaryTempC = 19;
    if (typeof recipe.planDiacetylTempC !== 'number') recipe.planDiacetylTempC = 21;
    if (typeof recipe.planDays !== 'number') recipe.planDays = 14;
    if (typeof recipe.planNeedsReview !== 'boolean') recipe.planNeedsReview = false;
  }
  for (const step of snapshot.mashSteps) {
    if (typeof step.needsReview !== 'boolean') step.needsReview = false;
    if (typeof step.sourceId !== 'string') step.sourceId = '';
  }
  for (const add of snapshot.boilAdds) {
    if (typeof add.needsReview !== 'boolean') add.needsReview = false;
    if (typeof add.sourceId !== 'string') add.sourceId = '';
  }
  for (const malt of snapshot.malts) {
    if (typeof malt.sourceId !== 'string') malt.sourceId = '';
  }
  for (const hop of snapshot.hops) {
    if (typeof hop.sourceId !== 'string') hop.sourceId = '';
  }
  const recipeById = new Map(snapshot.recipes.map((recipe) => [recipe.id, recipe]));
  for (const row of [...snapshot.ferments, ...snapshot.packagings]) {
    if (!row.seriesId) row.seriesId = recipeById.get(row.recipeId)?.seriesId ?? row.recipeId;
    if (!row.recipeVersionNo) row.recipeVersionNo = recipeById.get(row.recipeId)?.versionNo ?? 1;
  }
}

export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  normalizeSnapshot(snapshot);
  await db.transaction(
    'rw',
    [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds, db.ferments, db.packagings],
    async () => {
      await Promise.all([
        db.recipes.clear(),
        db.malts.clear(),
        db.hops.clear(),
        db.mashSteps.clear(),
        db.boilAdds.clear(),
        db.ferments.clear(),
        db.packagings.clear()
      ]);
      await db.recipes.bulkPut(snapshot.recipes.map(stamp));
      await db.malts.bulkPut(snapshot.malts.map(stamp));
      await db.hops.bulkPut(snapshot.hops.map(stamp));
      await db.mashSteps.bulkPut(snapshot.mashSteps.map(stamp));
      await db.boilAdds.bulkPut(snapshot.boilAdds.map(stamp));
      await db.ferments.bulkPut(snapshot.ferments.map(stamp));
      await db.packagings.bulkPut(snapshot.packagings.map(stamp));
    }
  );
}

/** 清空全部数据并重新灌入演示数据 */
export async function resetDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds, db.ferments, db.packagings],
    async () => {
      await Promise.all([
        db.recipes.clear(),
        db.malts.clear(),
        db.hops.clear(),
        db.mashSteps.clear(),
        db.boilAdds.clear(),
        db.ferments.clear(),
        db.packagings.clear()
      ]);
    }
  );
  await seedDatabase();
}

/** 各表行数统计 */
export async function countAll(): Promise<Record<string, number>> {
  const [recipes, malts, hops, mashSteps, boilAdds, ferments, packagings] = await Promise.all([
    db.recipes.count(),
    db.malts.count(),
    db.hops.count(),
    db.mashSteps.count(),
    db.boilAdds.count(),
    db.ferments.count(),
    db.packagings.count()
  ]);
  return { recipes, malts, hops, mashSteps, boilAdds, ferments, packagings };
}
