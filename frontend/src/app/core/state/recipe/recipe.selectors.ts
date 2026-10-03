/** 配方 feature selectors */
import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { RecipeRow } from '../../utils/db';
import { RecipeState } from './recipe.reducer';

export const selectRecipeState = createFeatureSelector<RecipeState>('recipe');

export const selectAllRecipes = createSelector(selectRecipeState, (state) => state.recipes);
export const selectRecipeFilter = createSelector(selectRecipeState, (state) => state.filter);
export const selectSelectedRecipeId = createSelector(selectRecipeState, (state) => state.selectedId);
export const selectRecipeLoading = createSelector(selectRecipeState, (state) => state.loading);
export const selectRecipeError = createSelector(selectRecipeState, (state) => state.error);
export const selectVersionConflict = createSelector(selectRecipeState, (state) => state.versionConflict);
export const selectVersionImpact = createSelector(selectRecipeState, (state) => state.versionImpact);

export const selectFilteredRecipes = createSelector(selectAllRecipes, selectRecipeFilter, (recipes, filter) => {
  const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
  const styles = Array.isArray(filter['styles']) ? (filter['styles']) : [];
  return recipes.filter((recipe) => {
    const label = `${recipe.name} ${recipe.style}`.toLowerCase();
    if (keyword && !label.includes(keyword)) return false;
    if (styles.length > 0 && !styles.includes(recipe.style)) return false;
    return true;
  });
});

export const selectSelectedRecipe = createSelector(
  selectAllRecipes,
  selectSelectedRecipeId,
  (recipes, id) => recipes.find((item) => item.id === id) ?? null
);

export const selectRecipeCount = createSelector(selectAllRecipes, (recipes) => recipes.length);

/** 配方家族分组：同一 familyId 的版本归为一组，列表默认展示最新版（含待复核） */
export interface RecipeFamilyGroup {
  familyId: string;
  name: string;
  style: string;
  /** 最新版本（版本号最大，可能是待复核） */
  latest: RecipeRow;
  /** 当前生效版本 */
  active: RecipeRow;
  /** 待复核版本（若有） */
  pending: RecipeRow | null;
  /** 全部版本（按版本号升序） */
  versions: RecipeRow[];
  /** 是否存在历史版本（已归档） */
  hasHistory: boolean;
}

export const selectRecipeFamilies = createSelector(selectAllRecipes, selectRecipeFilter, (recipes, filter) => {
  const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
  const styles = Array.isArray(filter['styles']) ? (filter['styles'] as string[]) : [];
  const map = new Map<string, RecipeRow[]>();
  for (const recipe of recipes) {
    const list = map.get(recipe.familyId) ?? [];
    list.push(recipe);
    map.set(recipe.familyId, list);
  }
  const groups: RecipeFamilyGroup[] = [];
  for (const [familyId, versions] of map) {
    const sorted = [...versions].sort((a, b) => a.versionNo - b.versionNo);
    const latest = sorted[sorted.length - 1];
    const active = sorted.find((v) => v.versionState === '生效中') ?? latest;
    const pending = sorted.find((v) => v.versionState === '待复核') ?? null;
    const label = `${latest.name} ${latest.style}`.toLowerCase();
    if (keyword && !label.includes(keyword)) continue;
    if (styles.length > 0 && !styles.includes(latest.style)) continue;
    groups.push({
      familyId,
      name: latest.name,
      style: latest.style,
      latest,
      active,
      pending,
      versions: sorted,
      hasHistory: sorted.some((v) => v.versionState === '已归档')
    });
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
});

/** 某家族的全部版本（按版本号升序） */
export const selectVersionsByFamily = (familyId: string) =>
  createSelector(selectAllRecipes, (recipes) =>
    recipes.filter((r) => r.familyId === familyId).sort((a, b) => a.versionNo - b.versionNo)
  );

/** 某家族的待复核版本（若有） */
export const selectPendingVersionByFamily = (familyId: string) =>
  createSelector(selectAllRecipes, (recipes) =>
    recipes.find((r) => r.familyId === familyId && r.versionState === '待复核') ?? null
  );
