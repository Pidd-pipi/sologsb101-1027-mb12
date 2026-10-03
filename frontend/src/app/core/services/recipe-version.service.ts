/**
 * RecipeVersionService：配方不可变版本化的核心逻辑。
 * - 同一家族（familyId）下版本号递增，每版不可变。
 * - 风格 / 目标指标 / 批次体积 / 原料配比变化时生成新版本：
 *   复制待执行糖化步、煮沸投加、未结束批次的发酵计划到新版并标记待复核；
 *   已完成工序、真实发酵读数、罐装批次继续绑定旧版（历史实绩不被改写）。
 * - 乐观并发：保存时校验 baseVersionId 是否仍为最新版，否则抛出 VersionConflictError（旧窗口列出冲突字段）。
 * - 切新版投产（activateVersion）前评估未结束批次影响，由调用方等用户确认后再执行。
 * 全部读写走 Dexie 事务，页面 / effects 不直接触碰版本落库细节。
 */
import { Injectable } from '@angular/core';
import type { RecipeDraft } from '../models/recipe.model';
import type { VersionConflictField, VersionImpact, VersionImpactBatch } from '../models/recipe-version.model';
import {
  db,
  ROW_REVISION,
  type BoilAddRow,
  type FermentRow,
  type HopRow,
  type MaltRow,
  type MashStepRow,
  type RecipeRow
} from '../utils/db';
import { createId } from '../utils/uuid';

/** 版本驱动字段的展示名与格式化（用于冲突字段弹窗） */
const VERSION_FIELD_META: Array<{
  key: 'style' | 'targetOg' | 'targetFg' | 'targetIbu' | 'targetEbc' | 'batchSizeL';
  label: string;
  format: (v: unknown) => string;
}> = [
  { key: 'style', label: '风格', format: (v) => String(v) },
  { key: 'targetOg', label: '目标 OG', format: (v) => Number(v).toFixed(3) },
  { key: 'targetFg', label: '目标 FG', format: (v) => Number(v).toFixed(3) },
  { key: 'targetIbu', label: '目标 IBU', format: (v) => String(v) },
  { key: 'targetEbc', label: '目标 EBC', format: (v) => String(v) },
  { key: 'batchSizeL', label: '批次体积', format: (v) => `${v} L` }
];

/** 并发冲突：旧窗口基于 base 版本保存时，latest 版本已被其他窗口改动 */
export class VersionConflictError extends Error {
  constructor(
    public readonly conflicts: VersionConflictField[],
    public readonly baseVersionId: string,
    public readonly latestVersionId: string
  ) {
    super('配方已被其他窗口修改，请基于最新版本重新编辑');
    this.name = 'VersionConflictError';
  }
}

/** 投产影响：存在未结束批次引用旧版，需用户明确确认后才切新版投产 */
export class ImpactRequiredError extends Error {
  constructor(public readonly impact: VersionImpact) {
    super('存在未结束批次引用旧版，切新版投产将影响这些批次的后续记录');
    this.name = 'ImpactRequiredError';
  }
}

export interface CreateVersionParams {
  /** 旧窗口所基于的版本 id（用于乐观并发校验） */
  baseVersionId: string;
  /** 新版配方字段 */
  payload: RecipeDraft;
  /** 原料配比覆盖：麦芽行 id → 新占比 % */
  maltRatios?: Record<string, number>;
  /** 原料配比覆盖：酒花行 id → 新用量 g */
  hopAmounts?: Record<string, number>;
}

@Injectable({ providedIn: 'root' })
export class RecipeVersionService {
  /** 家族全部版本（按版本号升序） */
  async listVersions(familyId: string): Promise<RecipeRow[]> {
    const rows = await db.recipes.where('familyId').equals(familyId).toArray();
    return rows.sort((a, b) => a.versionNo - b.versionNo);
  }

  async getLatestVersion(familyId: string): Promise<RecipeRow | undefined> {
    const versions = await this.listVersions(familyId);
    return versions.length > 0 ? versions[versions.length - 1] : undefined;
  }

  async getActiveVersion(familyId: string): Promise<RecipeRow | undefined> {
    const versions = await this.listVersions(familyId);
    return versions.find((v) => v.versionState === '生效中') ?? versions[versions.length - 1];
  }

  /** 某版本是否为其家族的最新版本（乐观并发校验用） */
  async isLatest(versionId: string): Promise<boolean> {
    const version = await db.recipes.get(versionId);
    if (!version) return true;
    const latest = await this.getLatestVersion(version.familyId);
    return latest?.id === versionId;
  }

  /**
   * 对比两个版本的冲突字段：版本驱动字段 + 原料配比。
   * 返回 base（旧窗口所见）与 latest（其他窗口已保存）不一致的字段。
   */
  async diffVersions(baseVersionId: string, latestVersionId: string): Promise<VersionConflictField[]> {
    const [base, latest, baseMalts, latestMalts, baseHops, latestHops] = await Promise.all([
      db.recipes.get(baseVersionId),
      db.recipes.get(latestVersionId),
      db.malts.where('recipeId').equals(baseVersionId).toArray(),
      db.malts.where('recipeId').equals(latestVersionId).toArray(),
      db.hops.where('recipeId').equals(baseVersionId).toArray(),
      db.hops.where('recipeId').equals(latestVersionId).toArray()
    ]);
    const conflicts: VersionConflictField[] = [];
    if (base && latest) {
      for (const meta of VERSION_FIELD_META) {
        const bv = (base as unknown as Record<string, unknown>)[meta.key];
        const lv = (latest as unknown as Record<string, unknown>)[meta.key];
        if (String(bv) !== String(lv)) {
          conflicts.push({ field: meta.key, label: meta.label, baseValue: meta.format(bv), latestValue: meta.format(lv) });
        }
      }
    }
    // 原料配比：按名称对齐（跨版本复制后行 id 会变）
    for (const bm of baseMalts) {
      const lm = latestMalts.find((m) => m.name === bm.name);
      if (lm && Number(bm.ratioPct) !== Number(lm.ratioPct)) {
        conflicts.push({
          field: `malt:${bm.name}`,
          label: `麦芽「${bm.name}」占比`,
          baseValue: `${bm.ratioPct}%`,
          latestValue: `${lm.ratioPct}%`
        });
      }
    }
    for (const bh of baseHops) {
      const lh = latestHops.find((h) => h.name === bh.name);
      if (lh && Number(bh.amountG) !== Number(lh.amountG)) {
        conflicts.push({
          field: `hop:${bh.name}`,
          label: `酒花「${bh.name}」用量`,
          baseValue: `${bh.amountG}g`,
          latestValue: `${lh.amountG}g`
        });
      }
    }
    return conflicts;
  }

  /**
   * 创建新版本（事务）。
   * - 乐观并发：baseVersionId 必须仍是家族最新版，否则抛 VersionConflictError。
   * - 复制麦芽 / 酒花（带配比覆盖）作为新版原料主数据。
   * - 复制未完成糖化步（未开始 / 进行中）与全部煮沸投加，标记 pendingReview。
   * - 复制未结束批次的发酵计划（isPlan 标记），真实读数留在旧版。
   */
  async createVersion(params: CreateVersionParams): Promise<{ id: string; versionNo: number }> {
    const base = await db.recipes.get(params.baseVersionId);
    if (!base) throw new Error('基准版本不存在，无法创建新版本');
    const latest = await this.getLatestVersion(base.familyId);
    if (latest && latest.id !== params.baseVersionId) {
      const conflicts = await this.diffVersions(params.baseVersionId, latest.id);
      throw new VersionConflictError(conflicts, params.baseVersionId, latest.id);
    }

    const versionNo = (latest?.versionNo ?? base.versionNo) + 1;
    const now = Date.now();
    const newId = createId('recipe');
    const draft: RecipeRow = {
      ...params.payload,
      id: newId,
      familyId: base.familyId,
      versionNo,
      baseVersionId: params.baseVersionId,
      versionState: '待复核',
      revision: ROW_REVISION,
      createdAt: now,
      updatedAt: now
    };

    await db.transaction(
      'rw',
      [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds, db.ferments],
      async () => {
        await db.recipes.put(draft);

        // 麦芽 / 酒花：复制为新版原料主数据，应用配比 / 用量覆盖
        const [malts, hops] = await Promise.all([
          db.malts.where('recipeId').equals(params.baseVersionId).toArray(),
          db.hops.where('recipeId').equals(params.baseVersionId).toArray()
        ]);
        for (const m of malts) {
          const ratio = params.maltRatios?.[m.id];
          const row: MaltRow = {
            ...m,
            id: createId('malt'),
            recipeId: newId,
            ratioPct: ratio ?? m.ratioPct,
            revision: ROW_REVISION,
            createdAt: now,
            updatedAt: now
          };
          await db.malts.put(row);
        }
        for (const h of hops) {
          const amount = params.hopAmounts?.[h.id];
          const row: HopRow = {
            ...h,
            id: createId('hop'),
            recipeId: newId,
            amountG: amount ?? h.amountG,
            revision: ROW_REVISION,
            createdAt: now,
            updatedAt: now
          };
          await db.hops.put(row);
        }

        // 糖化步：未完成的复制到新版并标记待复核；已完成的留在旧版（历史实绩不被改写）
        const mashSteps = await db.mashSteps.where('recipeId').equals(params.baseVersionId).toArray();
        for (const s of mashSteps) {
          if (s.state === '已完成') continue;
          const row: MashStepRow = {
            ...s,
            id: createId('mash'),
            recipeId: newId,
            pendingReview: true,
            revision: ROW_REVISION,
            createdAt: now,
            updatedAt: now
          };
          await db.mashSteps.put(row);
        }

        // 煮沸投加：全部复制到新版并标记待复核
        const boilAdds = await db.boilAdds.where('recipeId').equals(params.baseVersionId).toArray();
        for (const b of boilAdds) {
          const row: BoilAddRow = {
            ...b,
            id: createId('boil'),
            recipeId: newId,
            pendingReview: true,
            revision: ROW_REVISION,
            createdAt: now,
            updatedAt: now
          };
          await db.boilAdds.put(row);
        }

        // 发酵计划：未结束批次复制为新版计划（isPlan + 待复核）；真实读数留在旧版
        const ferments = await db.ferments.where('recipeId').equals(params.baseVersionId).toArray();
        const batchNos = Array.from(new Set(ferments.map((f) => f.batchNo)));
        for (const batchNo of batchNos) {
          const batchReadings = ferments
            .filter((f) => f.batchNo === batchNo)
            .sort((a, b) => a.date.localeCompare(b.date));
          const latestReading = batchReadings[batchReadings.length - 1];
          if (!latestReading || latestReading.state === '已结束') continue;
          const row: FermentRow = {
            ...latestReading,
            id: createId('ferment'),
            recipeId: newId,
            date: new Date().toISOString().slice(0, 10),
            isPlan: true,
            pendingReview: true,
            revision: ROW_REVISION,
            createdAt: now,
            updatedAt: now
          };
          await db.ferments.put(row);
        }
      }
    );

    return { id: newId, versionNo };
  }

  /**
   * 切新版投产：待复核 → 生效中；原生效中 → 已归档；清除新版计划的待复核标记。
   * 若存在未结束批次引用当前生效版且未确认影响，则抛 ImpactRequiredError。
   */
  async activateWithImpact(versionId: string, confirmImpact: boolean): Promise<void> {
    const version = await db.recipes.get(versionId);
    if (!version) throw new Error('版本不存在，无法投产');
    const versions = await this.listVersions(version.familyId);
    const currentActive = versions.find((v) => v.versionState === '生效中' && v.id !== versionId);
    if (currentActive && !confirmImpact) {
      const impact = await this.getImpact(currentActive.id);
      if (impact.unfinishedBatches.length > 0) {
        throw new ImpactRequiredError(impact);
      }
    }
    await this.activateVersion(versionId);
  }

  /** 直接启用投产（不做影响评估，内部方法） */
  private async activateVersion(versionId: string): Promise<void> {
    const version = await db.recipes.get(versionId);
    if (!version) throw new Error('版本不存在');
    const versions = await this.listVersions(version.familyId);
    const now = Date.now();
    await db.transaction('rw', [db.recipes, db.mashSteps, db.boilAdds, db.ferments], async () => {
      for (const v of versions) {
        if (v.id === versionId) {
          await db.recipes.update(v.id, { versionState: '生效中', updatedAt: now });
        } else if (v.versionState === '生效中') {
          await db.recipes.update(v.id, { versionState: '已归档', updatedAt: now });
        }
      }
      // 新版计划不再待复核
      await db.mashSteps.where('recipeId').equals(versionId).modify({ pendingReview: false, updatedAt: now } as never);
      await db.boilAdds.where('recipeId').equals(versionId).modify({ pendingReview: false, updatedAt: now } as never);
      await db.ferments.where('recipeId').equals(versionId).modify({ pendingReview: false, updatedAt: now } as never);
    });
  }

  /** 引用某版本的未结束批次（真实读数，排除计划标记） */
  async getUnfinishedBatches(versionId: string): Promise<VersionImpactBatch[]> {
    const ferments = await db.ferments.where('recipeId').equals(versionId).toArray();
    const real = ferments.filter((f) => !f.isPlan);
    const batchNos = Array.from(new Set(real.map((f) => f.batchNo)));
    const result: VersionImpactBatch[] = [];
    for (const batchNo of batchNos) {
      const readings = real
        .filter((f) => f.batchNo === batchNo)
        .sort((a, b) => a.date.localeCompare(b.date));
      const latest = readings[readings.length - 1];
      if (!latest || latest.state === '已结束') continue;
      result.push({ batchNo, state: latest.state, gravity: latest.gravity, date: latest.date });
    }
    return result;
  }

  /** 切新版投产的影响评估 */
  async getImpact(versionId: string): Promise<VersionImpact> {
    const [batches, mashSteps, boilAdds, plans] = await Promise.all([
      this.getUnfinishedBatches(versionId),
      db.mashSteps.where('recipeId').equals(versionId).toArray(),
      db.boilAdds.where('recipeId').equals(versionId).toArray(),
      db.ferments.where('recipeId').equals(versionId).toArray()
    ]);
    return {
      unfinishedBatches: batches,
      pendingMashStepCount: mashSteps.filter((s) => s.pendingReview).length,
      pendingBoilAddCount: boilAdds.filter((b) => b.pendingReview).length,
      pendingPlanCount: plans.filter((f) => f.isPlan && f.pendingReview).length
    };
  }

  /** 删除整个配方家族（所有版本及其麦芽 / 酒花 / 糖化步 / 煮沸投加 / 发酵读数 / 罐装批次） */
  async deleteFamily(familyId: string): Promise<void> {
    const versions = await this.listVersions(familyId);
    const ids = versions.map((v) => v.id);
    await db.transaction(
      'rw',
      [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds, db.ferments, db.packagings],
      async () => {
        for (const id of ids) {
          await Promise.all([
            db.malts.where('recipeId').equals(id).delete(),
            db.hops.where('recipeId').equals(id).delete(),
            db.mashSteps.where('recipeId').equals(id).delete(),
            db.boilAdds.where('recipeId').equals(id).delete(),
            db.ferments.where('recipeId').equals(id).delete(),
            db.packagings.where('recipeId').equals(id).delete()
          ]);
        }
        await db.recipes.where('familyId').equals(familyId).delete();
      }
    );
  }
}
