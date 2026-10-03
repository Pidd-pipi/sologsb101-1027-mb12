/** 配方版本 feature 的 NgRx actions */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { Recipe, RecipeFormValues } from '../../models/recipe.model';
import type { FilterModel } from '../../models/filter.model';
import type { RecipeRow } from '../../utils/db';
import type { FieldChange, FieldConflict } from '../../utils/recipe-version';

/** 从属数据变更后服务回传的结果（effect 据此把当前版本切到 fork 出的新版） */
export interface MutationResultProps {
  forked: boolean;
  effectiveRecipeId: string;
  changedFields: FieldChange[];
}

export const RecipeActions = createActionGroup({
  source: 'Recipe',
  events: {
    'Load Recipes': emptyProps(),
    'Load Recipes Success': props<{ recipes: RecipeRow[] }>(),
    'Load Failure': props<{ error: string }>(),
    'Reload All': emptyProps(),
    'Select Recipe': props<{ id: string | null }>(),
    'Set Filter': props<{ filter: FilterModel }>(),
    'Reset Filter': emptyProps(),
    'Create Recipe': props<{ payload: RecipeFormValues }>(),
    /** 保存配方（带窗口基线版本号与行时间戳，服务端做乐观锁校验） */
    'Save Recipe': props<{ id: string; baseVersionNo: number; baseUpdatedAt: number; values: RecipeFormValues }>(),
    /** 不经乐观锁的直接更新（保留给后台 / 兼容流程） */
    'Update Recipe': props<{ id: string; patch: Partial<Recipe> }>(),
    'Delete Recipe': props<{ id: string }>(),
    /** 保存成功（可能生成了新版本） */
    'Save Recipe Success': props<{ result: MutationResultProps }>(),
    /** 旧窗口基于过期版本保存被拒：携带最新版本与冲突字段 */
    'Save Recipe Conflict': props<{
      baseId: string;
      latestVersion: RecipeRow;
      conflicts: FieldConflict[];
      message: string;
    }>(),
    /** 请求切新版投产（若有在制批次，服务先抛 blocked，由窗口确认后再带 confirm 重放） */
    'Activate Version': props<{ id: string; confirmImpact: boolean }>(),
    'Cancel Activate': emptyProps(),
    'Activate Version Blocked': props<{
      id: string;
      pendingMashSteps: number;
      activeFermentReadings: number;
      activeBatchNos: string[];
    }>(),
    'Activate Version Success': props<{ id: string }>(),
    /** 复核通过：清除单条工序或整版工序的 needsReview */
    'Review Child': props<{ table: 'mashSteps' | 'boilAdds'; id: string }>(),
    /** 发酵计划复核通过 */
    'Review Plan': props<{ recipeId: string }>(),
    'Review All': props<{ recipeId: string }>()
  }
});
