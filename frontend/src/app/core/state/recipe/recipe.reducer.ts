/** 配方版本 feature reducer */
import { createReducer, on } from '@ngrx/store';
import type { FilterModel } from '../../models/filter.model';
import type { RecipeRow } from '../../utils/db';
import type { FieldConflict } from '../../utils/recipe-version';
import { RecipeActions } from './recipe.actions';

/** 旧窗口保存被拒时挂在 store 上的冲突信息（供冲突窗口列出冲突字段） */
export interface RecipeSaveConflict {
  baseId: string;
  latestVersion: RecipeRow;
  conflicts: FieldConflict[];
  message: string;
}

/** 切新版投产前等待用户确认的在制批次影响 */
export interface PendingActivation {
  id: string;
  pendingMashSteps: number;
  activeFermentReadings: number;
  activeBatchNos: string[];
}

export interface RecipeState {
  recipes: RecipeRow[];
  selectedId: string | null;
  filter: FilterModel;
  loading: boolean;
  error: string | null;
  conflict: RecipeSaveConflict | null;
  pendingActivation: PendingActivation | null;
}

export const initialRecipeState: RecipeState = {
  recipes: [],
  selectedId: null,
  filter: { keyword: '', styles: [] },
  loading: false,
  error: null,
  conflict: null,
  pendingActivation: null
};

/** 默认选中：优先正式投产版，其次版本号最大的版 */
function defaultSelected(recipes: RecipeRow[]): string | null {
  if (recipes.length === 0) return null;
  const active = recipes.find((item) => item.status === '正式投产');
  if (active) return active.id;
  return [...recipes].sort((a, b) => b.versionNo - a.versionNo)[0]?.id ?? null;
}

export const recipeReducer = createReducer(
  initialRecipeState,
  on(RecipeActions.loadRecipes, (state) => ({ ...state, loading: true, error: null })),
  on(RecipeActions.loadRecipesSuccess, (state, { recipes }) => ({
    ...state,
    recipes,
    loading: false,
    // 当前选中版本被删除时回退到默认版本；其余情况保留（可继续查看停用的历史版本）
    selectedId:
      state.selectedId && recipes.some((item) => item.id === state.selectedId)
        ? state.selectedId
        : defaultSelected(recipes)
  })),
  on(RecipeActions.loadFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RecipeActions.selectRecipe, (state, { id }) => ({ ...state, selectedId: id, conflict: null })),
  on(RecipeActions.setFilter, (state, { filter }) => ({ ...state, filter })),
  on(RecipeActions.resetFilter, (state) => ({ ...state, filter: { keyword: '', styles: [] } })),
  on(RecipeActions.saveRecipe, (state) => ({ ...state, conflict: null, error: null })),
  on(RecipeActions.saveRecipeSuccess, (state, { result }) => ({
    ...state,
    // fork 出新版本后把「当前配方」切到新版本，后续工序都录在新版上
    selectedId: result.effectiveRecipeId,
    conflict: null
  })),
  on(RecipeActions.saveRecipeConflict, (state, { baseId, latestVersion, conflicts, message }) => ({
    ...state,
    conflict: { baseId, latestVersion, conflicts, message }
  })),
  on(RecipeActions.activateVersion, (state) => ({ ...state, error: null })),
  on(RecipeActions.cancelActivate, (state) => ({ ...state, pendingActivation: null })),
  on(RecipeActions.activateVersionBlocked, (state, { id, pendingMashSteps, activeFermentReadings, activeBatchNos }) => ({
    ...state,
    pendingActivation: { id, pendingMashSteps, activeFermentReadings, activeBatchNos }
  })),
  on(RecipeActions.activateVersionSuccess, (state, { id }) => ({
    ...state,
    selectedId: id,
    pendingActivation: null
  })),
  on(RecipeActions.deleteRecipe, (state, { id }) => ({
    ...state,
    recipes: state.recipes.filter((item) => item.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId
  }))
);
