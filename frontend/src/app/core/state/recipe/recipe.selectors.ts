/** 配方版本 feature selectors */
import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { RecipeRow } from '../../utils/db';
import { RecipeState } from './recipe.reducer';

export const selectRecipeState = createFeatureSelector<RecipeState>('recipe');

export const selectAllRecipes = createSelector(selectRecipeState, (state) => state.recipes);
export const selectRecipeFilter = createSelector(selectRecipeState, (state) => state.filter);
export const selectSelectedRecipeId = createSelector(selectRecipeState, (state) => state.selectedId);
export const selectRecipeLoading = createSelector(selectRecipeState, (state) => state.loading);
export const selectRecipeError = createSelector(selectRecipeState, (state) => state.error);
export const selectSaveConflict = createSelector(selectRecipeState, (state) => state.conflict);
export const selectPendingActivation = createSelector(selectRecipeState, (state) => state.pendingActivation);

/** 一个配方系列（同一款酒的全部版本） */
export interface RecipeSeries {
  seriesId: string;
  name: string;
  style: string;
  versions: RecipeRow[];
  latest: RecipeRow;
  production: RecipeRow | null;
  /** 系列当前状态：有正式投产版 → 正式投产；否则看最新版状态 */
  status: RecipeRow['status'];
}

/** 按系列分组后的配方视图（每个系列一条，版本在组内按版本号升序） */
export const selectRecipeSeries = createSelector(selectAllRecipes, (recipes) => {
  const groups = new Map<string, RecipeRow[]>();
  for (const recipe of recipes) {
    const list = groups.get(recipe.seriesId) ?? [];
    list.push(recipe);
    groups.set(recipe.seriesId, list);
  }
  const series: RecipeSeries[] = [];
  for (const [seriesId, list] of groups) {
    const versions = [...list].sort((a, b) => a.versionNo - b.versionNo);
    const latest = versions[versions.length - 1];
    const production = versions.find((item) => item.status === '正式投产') ?? null;
    series.push({
      seriesId,
      name: latest.name,
      style: latest.style,
      versions,
      latest,
      production,
      status: production ? '正式投产' : latest.status
    });
  }
  return series.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
});

export const selectFilteredRecipeSeries = createSelector(selectRecipeSeries, selectRecipeFilter, (series, filter) => {
  const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
  const styles = Array.isArray(filter['styles']) ? (filter['styles'] as string[]) : [];
  return series.filter((item) => {
    const label = `${item.name} ${item.style}`.toLowerCase();
    if (keyword && !label.includes(keyword)) return false;
    if (styles.length > 0 && !styles.includes(item.style)) return false;
    return true;
  });
});

export const selectSelectedRecipe = createSelector(
  selectAllRecipes,
  selectSelectedRecipeId,
  (recipes, id) => recipes.find((item) => item.id === id) ?? null
);

/** 当前选中版本所属系列 */
export const selectSelectedSeries = createSelector(selectRecipeSeries, selectSelectedRecipeId, (series, id) => {
  if (!id) return null;
  return series.find((item) => item.versions.some((version) => version.id === id)) ?? null;
});

export const selectRecipeCount = createSelector(selectRecipeSeries, (series) => series.length);
export const selectRecipeVersionCount = createSelector(selectAllRecipes, (recipes) => recipes.length);

/** 新建发酵 / 罐装时默认选用的投产版本（无投产版时取版本号最大的版） */
export const selectDefaultProductionRecipe = createSelector(selectAllRecipes, (recipes) => {
  if (recipes.length === 0) return null;
  return recipes.find((item) => item.status === '正式投产') ?? [...recipes].sort((a, b) => b.versionNo - a.versionNo)[0];
});

/** 给定版本所属系列当前的正式投产版本（自身即投产版时返回自身；无投产版返回 null） */
export const selectProductionVersionOf = createSelector(
  selectAllRecipes,
  (recipes) => (recipeId: string | null | undefined) => {
    if (!recipeId) return null;
    const current = recipes.find((item) => item.id === recipeId);
    if (!current) return null;
    if (current.status === '正式投产') return current;
    return recipes.find((item) => item.seriesId === current.seriesId && item.status === '正式投产') ?? null;
  }
);
