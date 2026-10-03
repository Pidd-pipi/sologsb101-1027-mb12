/**
 * 配方版本 feature effects：把 NgRx actions 转成 Dexie 读写。
 * 所有变更动作完成后统一广播 Reload All，保证跨表数据一致；
 * fork 出版本后把当前配方切到新版本，保存冲突 / 投产拦截转为专门 action 供窗口展示。
 */
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import type { Action } from '@ngrx/store';
import { catchError, exhaustMap, forkJoin, from, map, of, switchMap } from 'rxjs';
import { RecipeService, type MutationResult } from '../../services/recipe.service';
import {
  ActiveBatchBlockedError,
  RecipeVersionConflictError,
  type ActiveBatchImpact
} from '../../utils/recipe-version';
import { IngredientsActions } from '../ingredients/ingredients.actions';
import { MashActions } from '../mash/mash.actions';
import { BoilActions } from '../boil/boil.actions';
import { RecipeActions } from './recipe.actions';

@Injectable()
export class RecipeEffects {
  private readonly actions$ = inject(Actions);
  private readonly service = inject(RecipeService);

  /** 一次性加载配方主表 + 全部从属表 */
  reloadAll$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RecipeActions.reloadAll),
      switchMap(() =>
        forkJoin({
          recipes: from(this.service.listRecipes()),
          malts: from(this.service.listMalts()),
          hops: from(this.service.listHops()),
          mashSteps: from(this.service.listMashSteps()),
          boilAdds: from(this.service.listBoilAdds())
        }).pipe(
          switchMap((data) => [
            RecipeActions.loadRecipesSuccess({ recipes: data.recipes }),
            IngredientsActions.loadIngredientsSuccess({ malts: data.malts, hops: data.hops }),
            MashActions.loadMashStepsSuccess({ steps: data.mashSteps }),
            BoilActions.loadBoilAddsSuccess({ adds: data.boilAdds })
          ]),
          catchError((error: unknown) =>
            of(RecipeActions.loadFailure({ error: error instanceof Error ? error.message : '本地数据读取失败' }))
          )
        )
      )
    )
  );

  /** 新建配方 */
  createRecipe$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RecipeActions.createRecipe),
      exhaustMap((action) =>
        from(this.service.createRecipe(action.payload)).pipe(
          switchMap((id) => [RecipeActions.saveRecipeSuccess({ result: { forked: false, effectiveRecipeId: id, changedFields: [] } }), RecipeActions.reloadAll()]),
          catchError((error: unknown) =>
            of(RecipeActions.loadFailure({ error: error instanceof Error ? error.message : '保存失败' }))
          )
        )
      )
    )
  );

  /** 保存配方（带乐观锁；冲突时只接受基于最新版本的保存，否则列出冲突字段） */
  saveRecipe$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RecipeActions.saveRecipe),
      exhaustMap((action) =>
        from(this.service.saveRecipe(action.id, action.baseVersionNo, action.baseUpdatedAt, action.values)).pipe(
          switchMap((result) => [
            RecipeActions.saveRecipeSuccess({ result }),
            RecipeActions.reloadAll()
          ]),
          catchError((error: unknown) => {
            if (error instanceof RecipeVersionConflictError) {
              return of(
                RecipeActions.saveRecipeConflict({
                  baseId: action.id,
                  latestVersion: error.latestVersion,
                  conflicts: error.conflicts,
                  message: error.message
                })
              );
            }
            return of(RecipeActions.loadFailure({ error: error instanceof Error ? error.message : '保存失败' }));
          })
        )
      )
    )
  );

  /** 删除配方（整系列级联） */
  deleteRecipe$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RecipeActions.deleteRecipe),
      exhaustMap((action) =>
        from(this.service.deleteRecipe(action.id)).pipe(
          map(() => RecipeActions.reloadAll()),
          catchError((error: unknown) =>
            of(RecipeActions.loadFailure({ error: error instanceof Error ? error.message : '删除失败' }))
          )
        )
      )
    )
  );

  /** 切新版投产：有未结束批次引用旧版时先要求确认 */
  activateVersion$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RecipeActions.activateVersion),
      exhaustMap((action) =>
        from(this.service.activateVersion(action.id, action.confirmImpact)).pipe(
          switchMap(() => [RecipeActions.activateVersionSuccess({ id: action.id }), RecipeActions.reloadAll()]),
          catchError((error: unknown) => {
            if (error instanceof ActiveBatchBlockedError) {
              const impact: ActiveBatchImpact = error.impact;
              return of(
                RecipeActions.activateVersionBlocked({
                  id: action.id,
                  pendingMashSteps: impact.pendingMashSteps,
                  activeFermentReadings: impact.activeFermentReadings,
                  activeBatchNos: impact.activeBatchNos
                })
              );
            }
            return of(RecipeActions.loadFailure({ error: error instanceof Error ? error.message : '投产切换失败' }));
          })
        )
      )
    )
  );

  /** 复核通过：单条工序 / 发酵计划 / 整版全部待复核内容 */
  review$ = createEffect(() =>
    this.actions$.pipe(
      ofType(RecipeActions.reviewChild, RecipeActions.reviewPlan, RecipeActions.reviewAll),
      exhaustMap((action) => {
        const task =
          action.type === RecipeActions.reviewChild.type
            ? this.service.clearChildReview(action.table, action.id)
            : action.type === RecipeActions.reviewPlan.type
              ? this.service.clearPlanReview(action.recipeId)
              : this.service.clearAllReview(action.recipeId);
        return from(task).pipe(
          map(() => RecipeActions.reloadAll()),
          catchError((error: unknown) =>
            of(RecipeActions.loadFailure({ error: error instanceof Error ? error.message : '复核失败' }))
          )
        );
      })
    )
  );

  /**
   * 麦芽 / 酒花 / 糖化步 / 煮沸投加的增删改：
   * 正式版本上的工艺编辑由服务自动 fork 出待复核新版，成功后把当前版本切到新版。
   */
  ingredientMutation$ = createEffect(() =>
    this.actions$.pipe(
      ofType(
        IngredientsActions.createMalt,
        IngredientsActions.updateMalt,
        IngredientsActions.deleteMalt,
        IngredientsActions.createHop,
        IngredientsActions.updateHop,
        IngredientsActions.deleteHop,
        MashActions.createMashStep,
        MashActions.updateMashStep,
        MashActions.deleteMashStep,
        BoilActions.createBoilAdd,
        BoilActions.updateBoilAdd,
        BoilActions.deleteBoilAdd
      ),
      exhaustMap((action) =>
        from(this.persistIngredient(action)).pipe(
          switchMap((result) =>
            result.forked
              ? [
                  RecipeActions.saveRecipeSuccess({ result }),
                  RecipeActions.reloadAll()
                ]
              : [RecipeActions.reloadAll()]
          ),
          catchError((error: unknown) =>
            of(RecipeActions.loadFailure({ error: error instanceof Error ? error.message : '保存失败' }))
          )
        )
      )
    )
  );

  /** 糖化步拖拽调序（仅同版本内部） */
  reorderMash$ = createEffect(() =>
    this.actions$.pipe(
      ofType(MashActions.reorderMashSteps),
      exhaustMap((action) =>
        from(this.service.reorderMashSteps(action.orderedIds)).pipe(
          map(() => RecipeActions.reloadAll()),
          catchError((error: unknown) =>
            of(RecipeActions.loadFailure({ error: error instanceof Error ? error.message : '调序失败' }))
          )
        )
      )
    )
  );

  private persistIngredient(action: Action): Promise<MutationResult> {
    const payload = action as unknown as Record<string, unknown>;
    switch (action.type) {
      case IngredientsActions.createMalt.type:
        return this.service.createMalt(payload['payload'] as never);
      case IngredientsActions.updateMalt.type:
        return this.service.updateMalt(payload['id'] as string, payload['patch'] as never);
      case IngredientsActions.deleteMalt.type:
        return this.service.deleteMalt(payload['id'] as string);
      case IngredientsActions.createHop.type:
        return this.service.createHop(payload['payload'] as never);
      case IngredientsActions.updateHop.type:
        return this.service.updateHop(payload['id'] as string, payload['patch'] as never);
      case IngredientsActions.deleteHop.type:
        return this.service.deleteHop(payload['id'] as string);
      case MashActions.createMashStep.type:
        return this.service.createMashStep(payload['payload'] as never);
      case MashActions.updateMashStep.type:
        return this.service.updateMashStep(payload['id'] as string, payload['patch'] as never);
      case MashActions.deleteMashStep.type:
        return this.service.deleteMashStep(payload['id'] as string);
      case BoilActions.createBoilAdd.type:
        return this.service.createBoilAdd(payload['payload'] as never);
      case BoilActions.updateBoilAdd.type:
        return this.service.updateBoilAdd(payload['id'] as string, payload['patch'] as never);
      default:
        return this.service.deleteBoilAdd(payload['id'] as string);
    }
  }
}
