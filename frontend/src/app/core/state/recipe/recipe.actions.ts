/** 配方 feature 的 NgRx actions */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { RecipeDraft } from '../../models/recipe.model';
import type { FilterModel } from '../../models/filter.model';
import type { VersionConflictField, VersionImpact } from '../../models/recipe-version.model';
import type { RecipeRow } from '../../utils/db';

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
    'Create Recipe': props<{ payload: RecipeDraft }>(),
    'Update Recipe': props<{ id: string; patch: Partial<RecipeDraft> }>(),
    'Delete Recipe': props<{ id: string }>(),
    // 不可变版本化
    'Create Recipe Version': props<{
      baseVersionId: string;
      payload: RecipeDraft;
      maltRatios?: Record<string, number>;
      hopAmounts?: Record<string, number>;
    }>(),
    'Create Recipe Version Success': props<{ id: string; versionNo: number }>(),
    'Create Recipe Version Conflict': props<{
      conflicts: VersionConflictField[];
      baseVersionId: string;
      latestVersionId: string;
    }>(),
    'Activate Recipe Version': props<{ versionId: string; confirmImpact: boolean }>(),
    'Activate Recipe Version Success': props<{ versionId: string }>(),
    'Activate Recipe Version Impact Required': props<{ versionId: string; impact: VersionImpact }>(),
    'Dismiss Version Conflict': emptyProps(),
    'Dismiss Version Impact': emptyProps()
  }
});
