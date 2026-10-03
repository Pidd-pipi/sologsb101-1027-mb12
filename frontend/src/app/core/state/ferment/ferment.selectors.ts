/** 发酵读数 feature selectors */
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { GravityTrendService } from '../../services/gravity-trend.service';
import { selectSelectedRecipe } from '../recipe/recipe.selectors';
import { FermentState } from './ferment.reducer';

export const selectFermentState = createFeatureSelector<FermentState>('ferment');

export const selectAllFerments = createSelector(selectFermentState, (state) => state.ferments);
export const selectFermentFilter = createSelector(selectFermentState, (state) => state.filter);
export const selectSelectedBatchNo = createSelector(selectFermentState, (state) => state.batchNo);
export const selectFermentError = createSelector(selectFermentState, (state) => state.error);

/** 真实发酵读数（排除新版计划标记 isPlan，不参与趋势 / 实绩计算） */
export const selectRealFerments = createSelector(selectAllFerments, (ferments) => ferments.filter((f) => !f.isPlan));

/** 全部批次号（去重，含计划标记所关联的未结束批次） */
export const selectBatchNumbers = createSelector(selectAllFerments, (ferments) =>
  Array.from(new Set(ferments.map((item) => item.batchNo))).sort()
);

/** 当前选中批次的真实读数（按日期升序，排除计划标记） */
export const selectCurrentBatchFerments = createSelector(
  selectRealFerments,
  selectSelectedBatchNo,
  (ferments, batchNo) =>
    ferments.filter((item) => item.batchNo === batchNo).sort((a, b) => a.date.localeCompare(b.date))
);

/** 按筛选条件过滤后的读数（排除计划标记） */
export const selectFilteredFerments = createSelector(
  selectRealFerments,
  selectFermentFilter,
  (ferments, filter) => {
    const keyword = String(filter['keyword'] ?? '').trim().toLowerCase();
    const states = Array.isArray(filter['states']) ? (filter['states'] as string[]) : [];
    return ferments.filter((item) => {
      const label = `${item.batchNo} ${item.state} ${item.date}`.toLowerCase();
      if (keyword && !label.includes(keyword)) return false;
      if (states.length > 0 && !states.includes(item.state)) return false;
      return true;
    });
  }
);

/** 当前批次的派生指标（表观发酵度 / 收得率 / 复调提示） */
export const selectCurrentBatchMetrics = createSelector(
  selectCurrentBatchFerments,
  selectSelectedRecipe,
  (ferments, recipe) => GravityTrendService.calculate(ferments, recipe)
);
