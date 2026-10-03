/** 配方 feature reducer */
import { createReducer, on } from '@ngrx/store';
import type { FilterModel } from '../../models/filter.model';
import type { VersionConflictField, VersionImpact } from '../../models/recipe-version.model';
import type { RecipeRow } from '../../utils/db';
import { RecipeActions } from './recipe.actions';

export interface VersionConflictState {
  conflicts: VersionConflictField[];
  baseVersionId: string;
  latestVersionId: string;
}

export interface RecipeState {
  recipes: RecipeRow[];
  selectedId: string | null;
  filter: FilterModel;
  loading: boolean;
  error: string | null;
  /** 并发冲突：旧窗口基于过期版本保存时填充，供弹窗列出冲突字段 */
  versionConflict: VersionConflictState | null;
  /** 投产影响：切新版投产前存在未结束批次引用旧版时填充，供弹窗等确认 */
  versionImpact: { versionId: string; impact: VersionImpact } | null;
}

export const initialRecipeState: RecipeState = {
  recipes: [],
  selectedId: null,
  filter: { keyword: '', styles: [] },
  loading: false,
  error: null,
  versionConflict: null,
  versionImpact: null
};

export const recipeReducer = createReducer(
  initialRecipeState,
  on(RecipeActions.loadRecipes, (state) => ({ ...state, loading: true, error: null })),
  on(RecipeActions.loadRecipesSuccess, (state, { recipes }) => ({
    ...state,
    recipes,
    loading: false,
    selectedId: state.selectedId ?? recipes[0]?.id ?? null
  })),
  on(RecipeActions.loadFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(RecipeActions.selectRecipe, (state, { id }) => ({ ...state, selectedId: id })),
  on(RecipeActions.setFilter, (state, { filter }) => ({ ...state, filter })),
  on(RecipeActions.resetFilter, (state) => ({ ...state, filter: { keyword: '', styles: [] } })),
  on(RecipeActions.deleteRecipe, (state, { id }) => ({
    ...state,
    recipes: state.recipes.filter((item) => item.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId
  })),
  on(RecipeActions.createRecipeVersion, (state) => ({ ...state, loading: true, error: null })),
  on(RecipeActions.createRecipeVersionSuccess, (state) => ({ ...state, loading: false, versionConflict: null })),
  on(RecipeActions.createRecipeVersionConflict, (state, { conflicts, baseVersionId, latestVersionId }) => ({
    ...state,
    loading: false,
    versionConflict: { conflicts, baseVersionId, latestVersionId }
  })),
  on(RecipeActions.activateRecipeVersion, (state) => ({ ...state, loading: true, error: null })),
  on(RecipeActions.activateRecipeVersionSuccess, (state, { versionId }) => ({
    ...state,
    loading: false,
    versionImpact: null,
    // 投产后选中新版，其他页面（糖化 / 煮沸 / 发酵 / 罐装）随之绑定到当前生产版本
    selectedId: versionId
  })),
  on(RecipeActions.activateRecipeVersionImpactRequired, (state, { versionId, impact }) => ({
    ...state,
    loading: false,
    versionImpact: { versionId, impact }
  })),
  on(RecipeActions.dismissVersionConflict, (state) => ({ ...state, versionConflict: null })),
  on(RecipeActions.dismissVersionImpact, (state) => ({ ...state, versionImpact: null }))
);
