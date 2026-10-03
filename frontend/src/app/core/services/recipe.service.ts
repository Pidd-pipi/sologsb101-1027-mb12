/**
 * RecipeService：配方版本及其从属数据（麦芽 / 酒花 / 糖化步 / 煮沸投加 / 发酵 / 罐装）的读写收口。
 * 版本规则：
 * - 正式配方不可变：改风格 / 目标指标 / 批次体积 / 原料配比 / 待执行工序时，自动 fork 出「待复核」新版本；
 * - fork 时复制麦芽、酒花与待执行糖化步（标记 needsReview）、全部煮沸投加（标记 needsReview）；
 *   已完成糖化步、发酵读数与罐装实绩继续绑定原版本；
 * - 保存只接受基于最新版本的提交，旧窗口提交抛 RecipeVersionConflictError 并带冲突字段；
 * - 切新版投产 activateVersion() 前强制校验在制批次影响，需 confirmImpact 才放行。
 */
import { Injectable, inject } from '@angular/core';
import type { Table } from 'dexie';
import type { Recipe, RecipeFormValues } from '../models/recipe.model';
import type { Malt } from '../models/malt.model';
import type { Hop } from '../models/hop.model';
import type { MashStep } from '../models/mash-step.model';
import type { BoilAdd } from '../models/boil-add.model';
import type { Ferment } from '../models/ferment.model';
import type { Packaging } from '../models/packaging.model';
import {
  db,
  removeRecipe,
  ROW_REVISION,
  type BoilAddRow,
  type FermentRow,
  type HopRow,
  type MaltRow,
  type MashStepRow,
  type PackagingRow,
  type RecipeRow
} from '../utils/db';
import { createId } from '../utils/uuid';
import {
  ActiveBatchBlockedError,
  RecipeVersionConflictError,
  computeActiveBatchImpact,
  detectSaveConflicts,
  diffRecipeFields,
  type ActiveBatchImpact,
  type FieldChange
} from '../utils/recipe-version';
import { IdbTableService } from './idb-table.service';

/** 从属数据变更后回传给 effect / 组件的结果：便于把「当前配方」切到新 fork 出的版本 */
export interface MutationResult {
  forked: boolean;
  /** 变更实际落库的配方版本 id（fork 后为新版本 id） */
  effectiveRecipeId: string;
  /** 触发 fork 的版本判定字段 */
  changedFields: FieldChange[];
}

@Injectable({ providedIn: 'root' })
export class RecipeService {
  private readonly idb = inject(IdbTableService);

  /* ------------------------------ 配方版本 ------------------------------ */

  listRecipes(): Promise<RecipeRow[]> {
    return db.recipes.toArray().then((rows) =>
      [...rows].sort((a, b) =>
        a.seriesId === b.seriesId
          ? a.versionNo - b.versionNo
          : a.name.localeCompare(b.name, 'zh-Hans-CN')
      )
    );
  }

  async getRecipe(id: string): Promise<RecipeRow | undefined> {
    return db.recipes.get(id);
  }

  /** 取某系列的全部版本（按版本号升序） */
  async listSeriesVersions(seriesId: string): Promise<RecipeRow[]> {
    const rows = await db.recipes.where('seriesId').equals(seriesId).toArray();
    return rows.sort((a, b) => a.versionNo - b.versionNo);
  }

  async createRecipe(payload: RecipeFormValues): Promise<string> {
    const now = Date.now();
    const id = createId('recipe');
    const row: RecipeRow = {
      ...payload,
      id,
      seriesId: id,
      versionNo: 1,
      status: '正式投产',
      revision: ROW_REVISION,
      createdAt: now,
      updatedAt: now
    };
    await db.recipes.put(row);
    return row.id;
  }

  /**
   * 保存配方表单（带乐观锁）。
   * @param id               窗口打开时基线版本 id
   * @param baseVersionNo    窗口打开时基线版本号
   * @param baseUpdatedAt    窗口打开时基线版本 updatedAt（捕获名称 / 计划类就地更新的并发覆盖）
   * @param values           窗口当前表单值
   */
  async saveRecipe(
    id: string,
    baseVersionNo: number,
    baseUpdatedAt: number,
    values: RecipeFormValues
  ): Promise<MutationResult> {
    return db.transaction(
      'rw',
      [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds, db.ferments, db.packagings],
      async () => {
        const base = await this.requireRecipe(id);
        const series = await this.listSeriesVersions(base.seriesId);
        const latest = series[series.length - 1];

        // 乐观锁：版本号落后，或同版本行已被其他窗口就地改过（updatedAt 前进），均视为过期窗口
        const staleVersion = latest.id !== base.id || latest.versionNo !== baseVersionNo;
        const staleRow = base.updatedAt !== baseUpdatedAt;
        if (staleVersion || staleRow) {
          const conflicts = detectSaveConflicts(this.formOf(base), values, this.formOf(latest));
          throw new RecipeVersionConflictError(latest, conflicts);
        }

        return this.applyRecipeValues(base, values);
      }
    );
  }

  /**
   * 把表单值应用到基线版本：
   * - 待复核草稿：直接就地更新（草稿尚未投产，仍可继续调整工艺）；
   * - 正式 / 停用版本：名称与发酵计划就地改，风格 / 目标指标 / 批次体积变化则 fork 新版。
   * 必须在已持有事务的上下文中调用。
   */
  private async applyRecipeValues(base: RecipeRow, values: RecipeFormValues): Promise<MutationResult> {
    const now = Date.now();
    if (base.status === '待复核') {
      // 保存即视为酿酒师已在表单中重新确认发酵计划
      await db.recipes.update(base.id, { ...values, planNeedsReview: false, updatedAt: now } as never);
      const changes = diffRecipeFields(this.formOf(base), values);
      return { forked: false, effectiveRecipeId: base.id, changedFields: changes };
    }

    const changes = diffRecipeFields(this.formOf(base), values);
    if (changes.length === 0) {
      // 仅名称或发酵计划变化：正式版本允许就地更新（不改变工艺解释，历史实绩不受影响）
      await db.recipes.update(base.id, {
        name: values.name,
        planPrimaryTempC: values.planPrimaryTempC,
        planDiacetylTempC: values.planDiacetylTempC,
        planDays: values.planDays,
        updatedAt: now
      } as never);
      return { forked: false, effectiveRecipeId: base.id, changedFields: [] };
    }
    const draft = await this.forkDraft(base, values);
    return { forked: true, effectiveRecipeId: draft.id, changedFields: changes };
  }

  /** 兼容旧接口：直接按 id 更新（不经过乐观锁，仅供后台流程使用） */
  updateRecipe(id: string, patch: Partial<Recipe>): Promise<void> {
    return this.idb.update(db.recipes, id, patch);
  }

  deleteRecipe(id: string): Promise<void> {
    return removeRecipe(id);
  }

  /**
   * 切新版投产：把 draftId 置为「正式投产」，同系列其他版本置为「已停用」。
   * 存在未结束批次仍引用旧版时，必须 confirmImpact=true 才能执行。
   */
  async activateVersion(draftId: string, confirmImpact: boolean): Promise<{ impact: ActiveBatchImpact }> {
    return db.transaction(
      'rw',
      [db.recipes, db.mashSteps, db.boilAdds, db.ferments],
      async () => {
        const draft = await this.requireRecipe(draftId);
        const impact = await this.activeImpact(draft.seriesId, [draft.id]);
        if (!confirmImpact && (impact.pendingMashSteps > 0 || impact.activeFermentReadings > 0)) {
          throw new ActiveBatchBlockedError(impact);
        }
        const now = Date.now();
        const siblings = await this.listSeriesVersions(draft.seriesId);
        for (const version of siblings) {
          if (version.id === draft.id) {
            await db.recipes.update(version.id, { status: '正式投产', updatedAt: now } as never);
          } else if (version.status !== '已停用') {
            await db.recipes.update(version.id, { status: '已停用', updatedAt: now } as never);
          }
        }
        return { impact };
      }
    );
  }

  /** 新版复制过来的单条糖化步 / 煮沸投加复核通过：清除 needsReview */
  async clearChildReview(table: 'mashSteps' | 'boilAdds', id: string): Promise<void> {
    await db.table(table).update(id, { needsReview: false, updatedAt: Date.now() } as never);
  }

  /** 新版复制过来的发酵计划复核通过：清除 planNeedsReview */
  async clearPlanReview(recipeId: string): Promise<void> {
    await db.recipes.update(recipeId, { planNeedsReview: false, updatedAt: Date.now() } as never);
  }

  /** 一键复核某版本全部待复核内容（发酵计划 + 糖化步 + 煮沸投加） */
  async clearAllReview(recipeId: string): Promise<void> {
    await db.transaction('rw', [db.recipes, db.mashSteps, db.boilAdds], async () => {
      await db.recipes.update(recipeId, { planNeedsReview: false, updatedAt: Date.now() } as never);
      await db.mashSteps.where('recipeId').equals(recipeId).modify({ needsReview: false, updatedAt: Date.now() } as never);
      await db.boilAdds.where('recipeId').equals(recipeId).modify({ needsReview: false, updatedAt: Date.now() } as never);
    });
  }

  /** 某系列切换投产时的在制影响（排除待投产新版本自身的待执行计划） */
  private async activeImpact(seriesId: string, excludeVersionIds: string[]): Promise<ActiveBatchImpact> {
    const older = (await this.listSeriesVersions(seriesId)).filter(
      (version) => !excludeVersionIds.includes(version.id)
    );
    if (older.length === 0) {
      return { pendingMashSteps: 0, activeFermentReadings: 0, activeBatchNos: [] };
    }
    const ids = older.map((version) => version.id);
    const [steps, ferments] = await Promise.all([
      db.mashSteps.where('recipeId').anyOf(ids).toArray(),
      db.ferments.where('seriesId').equals(seriesId).toArray()
    ]);
    return computeActiveBatchImpact(steps, ferments);
  }

  async previewActivateImpact(draftId: string): Promise<ActiveBatchImpact> {
    const draft = await this.requireRecipe(draftId);
    return this.activeImpact(draft.seriesId, [draft.id]);
  }

  /* --------------------------- fork 内部实现 --------------------------- */

  private formOf(recipe: Recipe): RecipeFormValues {
    const {
      name,
      style,
      targetOg,
      targetFg,
      targetIbu,
      targetEbc,
      batchSizeL,
      planPrimaryTempC,
      planDiacetylTempC,
      planDays,
      planNeedsReview
    } = recipe;
    return {
      name,
      style,
      targetOg,
      targetFg,
      targetIbu,
      targetEbc,
      batchSizeL,
      planPrimaryTempC,
      planDiacetylTempC,
      planDays,
      planNeedsReview
    };
  }

  /**
   * fork 出新版本草稿：复制工艺值 + 原料 + 待执行糖化步（needsReview）+ 全部煮沸投加（needsReview）。
   * 已完成糖化步、发酵读数、罐装批次不复制，继续绑定原版本。
   * 必须在事务内调用。
   */
  private async forkDraft(base: RecipeRow, values: RecipeFormValues): Promise<RecipeRow> {
    const series = await this.listSeriesVersions(base.seriesId);
    const nextNo = series.reduce((max, item) => Math.max(max, item.versionNo), 0) + 1;
    const now = Date.now();
    const draftId = createId('recipe');
    const draft: RecipeRow = {
      ...values,
      id: draftId,
      seriesId: base.seriesId,
      versionNo: nextNo,
      status: '待复核',
      planNeedsReview: true,
      revision: ROW_REVISION,
      createdAt: now,
      updatedAt: now
    };
    await db.recipes.put(draft);
    await this.copyIngredientsToDraft(base.id, draftId);
    await this.copyPendingMashSteps(base.id, draftId);
    await this.copyBoilAdds(base.id, draftId);
    return draft;
  }

  private async copyIngredientsToDraft(fromId: string, toId: string): Promise<void> {
    const now = Date.now();
    const [malts, hops] = await Promise.all([
      db.malts.where('recipeId').equals(fromId).toArray(),
      db.hops.where('recipeId').equals(fromId).toArray()
    ]);
    await db.malts.bulkPut(
      malts.map((row) => ({
        ...row,
        id: createId('malt'),
        sourceId: row.sourceId ?? row.id,
        recipeId: toId,
        revision: ROW_REVISION,
        createdAt: now,
        updatedAt: now
      }))
    );
    await db.hops.bulkPut(
      hops.map((row) => ({
        ...row,
        id: createId('hop'),
        sourceId: row.sourceId ?? row.id,
        recipeId: toId,
        revision: ROW_REVISION,
        createdAt: now,
        updatedAt: now
      }))
    );
  }

  private async copyPendingMashSteps(fromId: string, toId: string): Promise<void> {
    const now = Date.now();
    const steps = (await db.mashSteps.where('recipeId').equals(fromId).toArray())
      .filter((row) => row.state !== '已完成')
      .sort((a, b) => a.seq - b.seq);
    await db.mashSteps.bulkPut(
      steps.map((row, index) => ({
        ...row,
        id: createId('mash'),
        sourceId: row.sourceId ?? row.id,
        recipeId: toId,
        seq: index + 1,
        needsReview: true,
        revision: ROW_REVISION,
        createdAt: now,
        updatedAt: now
      }))
    );
  }

  private async copyBoilAdds(fromId: string, toId: string): Promise<void> {
    const now = Date.now();
    const adds = await db.boilAdds.where('recipeId').equals(fromId).toArray();
    await db.boilAdds.bulkPut(
      adds.map((row) => ({
        ...row,
        id: createId('boil'),
        sourceId: row.sourceId ?? row.id,
        recipeId: toId,
        needsReview: true,
        revision: ROW_REVISION,
        createdAt: now,
        updatedAt: now
      }))
    );
  }

  /**
   * 保证返回一个可写的版本：正式投产 / 已停用版本被改从属数据时，先 fork 草稿；
   * 待复核草稿直接返回自身。无论从哪个页面触发，新版都完整复制原料、待执行糖化步与煮沸投加，
   * 并把发酵计划标记为待复核，保证待执行计划成组复制、语义一致。
   * 必须在事务内调用。
   */
  private async ensureWritableDraft(
    recipeId: string,
    _scope: Array<'ingredients' | 'mash' | 'boil'>
  ): Promise<{ draft: RecipeRow; forked: boolean }> {
    const base = await this.requireRecipe(recipeId);
    if (base.status === '待复核') return { draft: base, forked: false };
    const series = await this.listSeriesVersions(base.seriesId);
    // 系列里已有待复核草稿时直接复用，避免同一正式版被并行改出多个草稿版本
    const existing = series.find((version) => version.status === '待复核');
    if (existing) return { draft: existing, forked: true };
    const nextNo = series.reduce((max, item) => Math.max(max, item.versionNo), 0) + 1;
    const now = Date.now();
    const draft: RecipeRow = {
      ...this.formOf(base),
      id: createId('recipe'),
      seriesId: base.seriesId,
      versionNo: nextNo,
      status: '待复核',
      planNeedsReview: true,
      revision: ROW_REVISION,
      createdAt: now,
      updatedAt: now
    };
    await db.recipes.put(draft);
    await this.copyIngredientsToDraft(base.id, draft.id);
    await this.copyPendingMashSteps(base.id, draft.id);
    await this.copyBoilAdds(base.id, draft.id);
    return { draft, forked: true };
  }

  private async requireRecipe(id: string): Promise<RecipeRow> {
    const row = await db.recipes.get(id);
    if (!row) throw new Error('配方版本不存在，可能已在其他窗口被删除');
    return row;
  }

  /* ------------------------------ 麦芽 ------------------------------ */

  listMalts(): Promise<MaltRow[]> {
    return db.malts.toArray();
  }

  async createMalt(payload: Omit<Malt, 'id'>): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds], async () => {
      const { draft } = await this.ensureWritableDraft(payload.recipeId, ['ingredients']);
      const now = Date.now();
      await db.malts.put({
        ...payload,
        recipeId: draft.id,
        id: createId('malt'),
        revision: ROW_REVISION,
        createdAt: now,
        updatedAt: now
      });
      return { forked: draft.id !== payload.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  async updateMalt(id: string, patch: Partial<Malt>): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds], async () => {
      const row = await this.requireSub(db.malts, id);
      const { draft } = await this.ensureWritableDraft(row.recipeId, ['ingredients']);
      const now = Date.now();
      if (draft.id === row.recipeId) {
        await db.malts.update(id, { ...patch, updatedAt: now } as never);
      } else {
        // 行属于正式版本：在草稿副本集合上等价修改（按复制来源 sourceId 定位副本）
        const copy = await this.findCopiedRow(db.malts, draft.id, row.sourceId ?? row.id);
        if (copy) await db.malts.update(copy.id, { ...patch, recipeId: draft.id, updatedAt: now } as never);
      }
      return { forked: draft.id !== row.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  async deleteMalt(id: string): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds], async () => {
      const row = await this.requireSub(db.malts, id);
      const { draft } = await this.ensureWritableDraft(row.recipeId, ['ingredients']);
      if (draft.id === row.recipeId) {
        await db.malts.delete(id);
      } else {
        // 正式版本的行不物理删除（历史可追溯）：仅在 fork 出的草稿中删除对应副本
        const copy = await this.findCopiedRow(db.malts, draft.id, row.sourceId ?? row.id);
        if (copy) await db.malts.delete(copy.id);
      }
      return { forked: draft.id !== row.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  /* ------------------------------ 酒花 ------------------------------ */

  listHops(): Promise<HopRow[]> {
    return db.hops.toArray();
  }

  async createHop(payload: Omit<Hop, 'id'>): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds], async () => {
      const { draft } = await this.ensureWritableDraft(payload.recipeId, ['ingredients']);
      const now = Date.now();
      await db.hops.put({
        ...payload,
        recipeId: draft.id,
        id: createId('hop'),
        revision: ROW_REVISION,
        createdAt: now,
        updatedAt: now
      });
      return { forked: draft.id !== payload.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  async updateHop(id: string, patch: Partial<Hop>): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds], async () => {
      const row = await this.requireSub(db.hops, id);
      const { draft } = await this.ensureWritableDraft(row.recipeId, ['ingredients']);
      const now = Date.now();
      if (draft.id === row.recipeId) {
        await db.hops.update(id, { ...patch, updatedAt: now } as never);
      } else {
        const copy = await this.findCopiedRow(db.hops, draft.id, row.sourceId ?? row.id);
        if (copy) await db.hops.update(copy.id, { ...patch, recipeId: draft.id, updatedAt: now } as never);
      }
      return { forked: draft.id !== row.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  async deleteHop(id: string): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.malts, db.hops, db.mashSteps, db.boilAdds], async () => {
      const row = await this.requireSub(db.hops, id);
      const { draft } = await this.ensureWritableDraft(row.recipeId, ['ingredients']);
      if (draft.id === row.recipeId) {
        await db.hops.delete(id);
      } else {
        const copy = await this.findCopiedRow(db.hops, draft.id, row.sourceId ?? row.id);
        if (copy) await db.hops.delete(copy.id);
      }
      return { forked: draft.id !== row.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  /* ----------------------------- 糖化步 ----------------------------- */

  listMashSteps(): Promise<MashStepRow[]> {
    return db.mashSteps.toArray().then((rows) => rows.sort((a, b) => a.seq - b.seq));
  }

  async createMashStep(payload: Omit<MashStep, 'id' | 'seq'>): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.mashSteps, db.boilAdds], async () => {
      const { draft } = await this.ensureWritableDraft(payload.recipeId, ['mash']);
      const existing = await db.mashSteps.where('recipeId').equals(draft.id).toArray();
      const seq = existing.reduce((max, row) => Math.max(max, row.seq), 0) + 1;
      const now = Date.now();
      await db.mashSteps.put({
        ...payload,
        recipeId: draft.id,
        seq,
        id: createId('mash'),
        revision: ROW_REVISION,
        createdAt: now,
        updatedAt: now
      });
      return { forked: draft.id !== payload.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  /**
   * 更新糖化步：仅签署完成状态（state → 已完成，且不带其他工艺改动）属于车间实绩，
   * 直接写回当前版本，不 fork；其余编辑在待复核草稿上进行。
   */
  async updateMashStep(id: string, patch: Partial<MashStep>): Promise<MutationResult> {
    const row = await this.requireSub(db.mashSteps, id);
    const onlyCompletion =
      row.state !== '已完成' &&
      patch.state === '已完成' &&
      Object.keys(patch).every((key) => key === 'state' || key === 'needsReview');
    if (onlyCompletion) {
      await this.idb.update(db.mashSteps, id, { state: '已完成', needsReview: false });
      return { forked: false, effectiveRecipeId: row.recipeId, changedFields: [] };
    }
    return db.transaction('rw', [db.recipes, db.mashSteps, db.boilAdds], async () => {
      const { draft } = await this.ensureWritableDraft(row.recipeId, ['mash']);
      const now = Date.now();
      if (draft.id === row.recipeId) {
        await db.mashSteps.update(id, { ...patch, updatedAt: now } as never);
      } else {
        const copy = await this.findCopiedRow(db.mashSteps, draft.id, row.sourceId ?? row.id);
        if (copy) await db.mashSteps.update(copy.id, { ...patch, recipeId: draft.id, needsReview: false, updatedAt: now } as never);
      }
      return { forked: draft.id !== row.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  async deleteMashStep(id: string): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.mashSteps, db.boilAdds], async () => {
      const row = await this.requireSub(db.mashSteps, id);
      const { draft } = await this.ensureWritableDraft(row.recipeId, ['mash']);
      if (draft.id === row.recipeId) {
        await db.mashSteps.delete(id);
      } else {
        const copy = await this.findCopiedRow(db.mashSteps, draft.id, row.sourceId ?? row.id);
        if (copy) await db.mashSteps.delete(copy.id);
      }
      return { forked: draft.id !== row.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  /** 拖拽调序：仅允许同一版本内部排序；传入的必须是该版本下的步 id */
  async reorderMashSteps(orderedIds: string[]): Promise<void> {
    await db.transaction('rw', [db.mashSteps], async () => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await db.mashSteps.update(orderedIds[index], { seq: index + 1, updatedAt: Date.now() } as never);
      }
    });
  }

  /* ---------------------------- 煮沸投加 ---------------------------- */

  listBoilAdds(): Promise<BoilAddRow[]> {
    return db.boilAdds.toArray();
  }

  async createBoilAdd(payload: Omit<BoilAdd, 'id'>): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.mashSteps, db.boilAdds], async () => {
      const { draft } = await this.ensureWritableDraft(payload.recipeId, ['boil']);
      const now = Date.now();
      await db.boilAdds.put({
        ...payload,
        recipeId: draft.id,
        id: createId('boil'),
        revision: ROW_REVISION,
        createdAt: now,
        updatedAt: now
      });
      return { forked: draft.id !== payload.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  async updateBoilAdd(id: string, patch: Partial<BoilAdd>): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.mashSteps, db.boilAdds], async () => {
      const row = await this.requireSub(db.boilAdds, id);
      const { draft } = await this.ensureWritableDraft(row.recipeId, ['boil']);
      const now = Date.now();
      if (draft.id === row.recipeId) {
        await db.boilAdds.update(id, { ...patch, updatedAt: now } as never);
      } else {
        const copy = await this.findCopiedRow(db.boilAdds, draft.id, row.sourceId ?? row.id);
        if (copy) await db.boilAdds.update(copy.id, { ...patch, recipeId: draft.id, needsReview: false, updatedAt: now } as never);
      }
      return { forked: draft.id !== row.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  async deleteBoilAdd(id: string): Promise<MutationResult> {
    return db.transaction('rw', [db.recipes, db.mashSteps, db.boilAdds], async () => {
      const row = await this.requireSub(db.boilAdds, id);
      const { draft } = await this.ensureWritableDraft(row.recipeId, ['boil']);
      if (draft.id === row.recipeId) {
        await db.boilAdds.delete(id);
      } else {
        const copy = await this.findCopiedRow(db.boilAdds, draft.id, row.sourceId ?? row.id);
        if (copy) await db.boilAdds.delete(copy.id);
      }
      return { forked: draft.id !== row.recipeId, effectiveRecipeId: draft.id, changedFields: [] };
    });
  }

  /* ---------------------------- 发酵读数 ---------------------------- */

  listFerments(): Promise<FermentRow[]> {
    return db.ferments.toArray().then((rows) => rows.sort((a, b) => a.date.localeCompare(b.date)));
  }

  /** 读数永远绑定提交时选定的具体版本；自动补齐系列与版本号，历史实绩不被改写 */
  async createFerment(payload: Omit<Ferment, 'id'>): Promise<string> {
    const recipe = await this.requireRecipe(payload.recipeId);
    const row = {
      ...payload,
      recipeId: recipe.id,
      seriesId: recipe.seriesId,
      recipeVersionNo: recipe.versionNo,
      id: createId('ferment'),
      revision: ROW_REVISION,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await db.ferments.put(row);
    return row.id;
  }

  async updateFerment(id: string, patch: Partial<Ferment>): Promise<void> {
    await this.idb.update(db.ferments, id, patch);
  }

  deleteFerment(id: string): Promise<void> {
    return this.idb.remove(db.ferments, id);
  }

  /* ---------------------------- 罐装批次 ---------------------------- */

  listPackagings(): Promise<PackagingRow[]> {
    return db.packagings.toArray().then((rows) => rows.sort((a, b) => b.packDate.localeCompare(a.packDate)));
  }

  /** 罐装实绩绑定具体版本，自动补齐系列与版本号 */
  async createPackaging(payload: Omit<Packaging, 'id'>): Promise<string> {
    const recipe = await this.requireRecipe(payload.recipeId);
    const row = {
      ...payload,
      recipeId: recipe.id,
      seriesId: recipe.seriesId,
      recipeVersionNo: recipe.versionNo,
      id: createId('packaging'),
      revision: ROW_REVISION,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await db.packagings.put(row);
    return row.id;
  }

  updatePackaging(id: string, patch: Partial<Packaging>): Promise<void> {
    return this.idb.update(db.packagings, id, patch);
  }

  deletePackaging(id: string): Promise<void> {
    return this.idb.remove(db.packagings, id);
  }

  /* ------------------------------ 辅助 ------------------------------ */

  /** 在草稿版本中按复制来源 sourceId 查找副本行（兼容老数据无 sourceId 时回退按 id） */
  private async findCopiedRow<T extends { id: string; recipeId: string; sourceId?: string }>(
    table: Table<T, string>,
    draftRecipeId: string,
    sourceId: string
  ): Promise<T | undefined> {
    const rows = await table.where('recipeId').equals(draftRecipeId).toArray();
    return rows.find((item) => (item.sourceId ?? item.id) === sourceId);
  }

  private async requireSub<T extends { id: string; recipeId: string }>(
    table: Table<T, string>,
    id: string
  ): Promise<T> {
    const row = await table.get(id);
    if (!row) throw new Error('工序记录不存在，可能已在其他窗口被删除');
    return row;
  }
}
