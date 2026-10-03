/**
 * 配方不可变版本：版本判定、字段冲突比对与批次影响分析的纯函数。
 * - 风格 / 目标指标 / 批次体积 / 原料配比变化 → 生成新版本；其余字段（名称、发酵计划）就地更新
 * - 保存只接受基于最新版本的提交，旧窗口提交时给出冲突字段
 * - 已完成糖化步 / 发酵读数 / 罐装实绩永远绑定原版本，不被新版改写
 */
import type { Recipe, RecipeFormValues } from '../models/recipe.model';
import type { RecipeRow } from './db';
import type { MashStep } from '../models/mash-step.model';
import type { Ferment } from '../models/ferment.model';

/** 触发新版本的工艺字段（风格、目标指标、批次体积） */
export const VERSION_DEFINING_RECIPE_FIELDS = [
  'style',
  'targetOg',
  'targetFg',
  'targetIbu',
  'targetEbc',
  'batchSizeL'
] as const;

/** 表单中可编辑的全部字段（含就地更新的名称 / 发酵计划） */
export const RECIPE_FORM_FIELDS = [
  'name',
  'style',
  'targetOg',
  'targetFg',
  'targetIbu',
  'targetEbc',
  'batchSizeL',
  'planPrimaryTempC',
  'planDiacetylTempC',
  'planDays'
] as const;

export type RecipeFormField = (typeof RECIPE_FORM_FIELDS)[number];

/** 原料配比变化（麦芽 / 酒花）也触发新版本；该判定由 service 汇总后传入 */
export const INGREDIENT_CHANGE_REASON = 'ingredient' as const;

export type VersionDefiningField = (typeof VERSION_DEFINING_RECIPE_FIELDS)[number] | typeof INGREDIENT_CHANGE_REASON;

/** 字段中文标签（冲突窗口与投产确认弹窗展示） */
export const FIELD_LABELS: Record<VersionDefiningField | RecipeFormField, string> = {
  name: '配方名称',
  style: '风格',
  targetOg: '目标 OG',
  targetFg: '目标 FG',
  targetIbu: '目标 IBU',
  targetEbc: '目标 EBC',
  batchSizeL: '批次体积',
  planPrimaryTempC: '主发酵温度',
  planDiacetylTempC: '还原温度',
  planDays: '发酵天数',
  ingredient: '原料配比'
};

/** 单条字段差异 */
export interface FieldChange {
  field: VersionDefiningField;
  label: string;
  before: string | number;
  after: string | number;
}

function changedFields(a: RecipeFormValues, b: RecipeFormValues): Array<(typeof VERSION_DEFINING_RECIPE_FIELDS)[number]> {
  return VERSION_DEFINING_RECIPE_FIELDS.filter((field) => a[field] !== b[field]);
}

/** 比较表单与某版本：返回发生变化的版本判定字段 */
export function diffRecipeFields(current: RecipeFormValues, next: RecipeFormValues): FieldChange[] {
  return changedFields(current, next).map((field) => ({
    field,
    label: FIELD_LABELS[field],
    before: current[field],
    after: next[field]
  }));
}

/** 表单是否改动了会生成新版本的字段 */
export function hasVersionDefiningChange(current: RecipeFormValues, next: RecipeFormValues): boolean {
  return changedFields(current, next).length > 0;
}

/** 两个窗口并发保存时的字段冲突 */
export interface FieldConflict {
  field: RecipeFormField;
  label: string;
  /** 旧窗口打开时基线版本的值 */
  baseValue: string | number;
  /** 旧窗口试图保存的值 */
  attemptedValue: string | number;
  /** 最新版本上已经保存的值 */
  latestValue: string | number;
}

/**
 * 乐观锁冲突检测（旧窗口已被判定为过期后调用）：
 * 列出「本窗口提交值」与「最新版本值」仍不一致的全部可编辑字段，
 * 既覆盖风格 / 目标指标等版本判定字段，也覆盖名称 / 发酵计划等就地更新字段，
 * 避免旧窗口 fork 新版时把其他窗口已改的名称 / 计划静默改回。
 */
export function detectSaveConflicts(
  base: RecipeFormValues,
  next: RecipeFormValues,
  latest: RecipeFormValues
): FieldConflict[] {
  return RECIPE_FORM_FIELDS.filter((field) => next[field] !== latest[field]).map((field) => ({
    field,
    label: FIELD_LABELS[field],
    baseValue: base[field],
    attemptedValue: next[field],
    latestValue: latest[field]
  }));
}

/** 仍在引用旧版本、未结束的批次（投产新版前必须让用户确认影响） */
export interface ActiveBatchImpact {
  /** 尚未全部完成的糖化步数（进行中 / 未开始） */
  pendingMashSteps: number;
  /** 未结束（state !== '已结束'）的发酵读数条数 */
  activeFermentReadings: number;
  /** 涉及的在制批次号 */
  activeBatchNos: string[];
}

/** 引用某版本的在制批次是否需要确认 */
export function hasActiveBatchImpact(impact: ActiveBatchImpact): boolean {
  return impact.pendingMashSteps > 0 || impact.activeFermentReadings > 0;
}

/** 取一个系列里版本号最大的版本行 */
export function latestVersionOf(versions: Recipe[]): Recipe | undefined {
  return versions.reduce<Recipe | undefined>(
    (max, item) => (max && max.versionNo >= item.versionNo ? max : item),
    undefined
  );
}

/** 汇总某版本下仍在制、尚未结束的工序与批次 */
export function computeActiveBatchImpact(steps: MashStep[], ferments: Ferment[]): ActiveBatchImpact {
  const pendingMashSteps = steps.filter((item) => item.state !== '已完成').length;
  const active = ferments.filter((item) => item.state !== '已结束');
  return {
    pendingMashSteps,
    activeFermentReadings: active.length,
    activeBatchNos: Array.from(new Set(active.map((item) => item.batchNo))).sort()
  };
}

/** 保存被拒绝的原因 */
export type RecipeSaveRejectReason = 'not-latest' | 'has-conflict';

/** 旧窗口基于过期版本保存时抛出，携带冲突字段供窗口列出 */
export class RecipeVersionConflictError extends Error {
  constructor(
    public readonly latestVersion: RecipeRow,
    public readonly conflicts: FieldConflict[]
  ) {
    super(conflicts.length > 0 ? '配方已被其他窗口更新，存在字段冲突' : '配方已被其他窗口更新，请刷新后基于最新版本保存');
    this.name = 'RecipeVersionConflictError';
  }
}

/** 有未结束批次仍引用旧版、尚未确认影响时抛出 */
export class ActiveBatchBlockedError extends Error {
  constructor(public readonly impact: ActiveBatchImpact) {
    super('仍有未结束批次引用旧版本，需确认影响后才能切新版投产');
    this.name = 'ActiveBatchBlockedError';
  }
}

