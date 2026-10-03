/** /recipes 配方与风格台账：配方按系列分组、版本不可变，维护目标指标并显示与实绩的偏差 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { Actions, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';import { FilterBarComponent } from '../../shared/components/filter-bar/filter-bar.component';
import { StatBadgeComponent } from '../../shared/components/stat-badge/stat-badge.component';
import { EmptyPanelComponent } from '../../shared/components/empty-panel/empty-panel.component';
import { StyleTagComponent } from '../../shared/components/style-tag/style-tag.component';
import {
  BEER_STYLES,
  createEmptyRecipe,
  type Recipe,
  type RecipeFormValues
} from '../../core/models/recipe.model';
import type { RecipeRow } from '../../core/utils/db';
import { filtersToQueryParams, queryParamsToFilters, type FilterModel, type FilterSelectConfig } from '../../core/models/filter.model';
import { RecipeActions } from '../../core/state/recipe/recipe.actions';
import {
  selectFilteredRecipeSeries,
  selectPendingActivation,
  selectRecipeError,
  selectRecipeFilter,
  selectRecipeLoading,
  selectSaveConflict,
  selectSelectedRecipe,
  selectSelectedRecipeId,
  selectSelectedSeries,
  type RecipeSeries
} from '../../core/state/recipe/recipe.selectors';
import { selectAllMalts } from '../../core/state/ingredients/ingredients.selectors';
import { selectAllMashSteps } from '../../core/state/mash/mash.selectors';
import { selectAllBoilAdds } from '../../core/state/boil/boil.selectors';
import { selectAllFerments } from '../../core/state/ferment/ferment.selectors';
import { selectAllPackagings } from '../../core/state/packaging/packaging.selectors';
import { abvFromGravity, apparentAttenuation, ebcDeviation, totalGrainKg } from '../../core/utils/brew';

interface EditState {
  /** 编辑对象：新建为 null；编辑时为被打开的版本行（基线，用于乐观锁） */
  base: RecipeRow | null;
  values: RecipeFormValues;
}
@Component({
  selector: 'app-recipe-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    FilterBarComponent,
    StatBadgeComponent,
    EmptyPanelComponent,
    StyleTagComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page__head">
        <div>
          <h2 class="page__title">配方与风格台账</h2>
          <p class="page__subtitle">
            正式配方按版本封存：风格、目标指标、批次体积或原料配比变化会生成新版本，待执行工序复制后需复核。
          </p>
        </div>
        <button mat-flat-button color="primary" type="button" (click)="openCreate()">
          <mat-icon>add</mat-icon>
          新建配方
        </button>
      </div>

      <div class="badge-row">
        <app-stat-badge label="配方系列" [value]="series().length" suffix="款" tone="primary" icon="menu_book" />
        <app-stat-badge label="配方版本" [value]="versionCount()" suffix="个" tone="default" icon="history" />
        <app-stat-badge label="待复核版本" [value]="draftCount()" suffix="个" tone="warning" icon="rule" />
        <app-stat-badge label="已罐装配方" [value]="packagedSeriesCount()" suffix="款" tone="success" icon="inventory_2" />
      </div>

      <app-filter-bar
        [filters]="filter()"
        [selects]="selects"
        keywordPlaceholder="搜索配方名称 / 风格…"
        (filtersChange)="onFilterChange($event)"
        (reset)="onResetFilter()"
      ></app-filter-bar>

      @if (error()) {
        <mat-card appearance="outlined"><mat-card-content>{{ error() }}</mat-card-content></mat-card>
      }

      @if (loading()) {
        <mat-card appearance="outlined"><mat-card-content>正在读取本地配方库…</mat-card-content></mat-card>
      }

      @if (series().length === 0) {
        <app-empty-panel
          title="还没有匹配的配方"
          description="新建一个糖化配方，再为它配置麦芽、酒花与糖化升温步。"
          createText="新建配方"
          (create)="openCreate()"
        ></app-empty-panel>
      } @else {
        <div class="grid-series">
          @for (item of series(); track item.seriesId) {
            <mat-card appearance="outlined" class="series-card">
              <mat-card-header>
                <mat-card-title>{{ item.name }}</mat-card-title>
                <mat-card-subtitle>
                  <app-style-tag [value]="item.style"></app-style-tag>
                  <span class="muted">{{ item.versions.length }} 个版本 · 当前批次 {{ item.latest.batchSizeL }} L</span>
                </mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                <table class="data-table version-table">
                  <thead>
                    <tr>
                      <th>版本</th>
                      <th>状态</th>
                      <th>目标 OG/FG</th>
                      <th>IBU/EBC</th>
                      <th>实绩 OG/FG（绑定该版）</th>
                      <th>待复核工序</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (version of item.versions; track version.id) {
                      <tr [class.row--selected]="version.id === selectedId()">
                        <td><strong>v{{ version.versionNo }}</strong></td>
                        <td>
                          <app-style-tag [value]="version.status"></app-style-tag>
                        </td>
                        <td>{{ version.targetOg }} / {{ version.targetFg }}</td>
                        <td>{{ version.targetIbu }} / {{ version.targetEbc }}</td>
                        <td>{{ realizedOg(item.seriesId, version.id) }} / {{ realizedFg(item.seriesId, version.id) }}</td>
                        <td>
                          @if (reviewCount(version.id) > 0 || version.planNeedsReview) {
                            <span class="review-flag">
                              {{ reviewCount(version.id) + (version.planNeedsReview ? 1 : 0) }} 条待复核
                            </span>
                          } @else {
                            <span class="muted">—</span>
                          }
                        </td>
                        <td class="version-ops">
                          <button mat-button type="button" (click)="select(version.id)">查看</button>
                          @if (version.status === '待复核') {
                            @if (version.planNeedsReview) {
                              <button mat-button type="button" (click)="reviewPlan(version.id)">发酵计划复核</button>
                            }
                            <button mat-button color="primary" type="button" (click)="activate(version.id)">投产新版</button>
                            <button mat-button type="button" (click)="reviewAll(version.id)">全部复核</button>
                          }
                          <button mat-button type="button" (click)="edit(version)">编辑</button>
                          <button mat-button color="warn" type="button" (click)="remove(item)">删除全系列</button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>

                <div class="series-meta">
                  <span class="muted">
                    实绩 ABV {{ seriesAbv(item) }} %vol · 发酵度 {{ seriesAttenuation(item) }} % ·
                    色度偏差 {{ ebcDelta(item) }} EBC · 投料 {{ grainKg(item.latest) }} kg
                  </span>
                </div>
              </mat-card-content>
            </mat-card>
          }
        </div>
      }

      @if (activationPrompt(); as prompt) {
        <mat-card appearance="outlined" class="prompt-card">
          <mat-card-header><mat-card-title>切新版投产影响确认</mat-card-title></mat-card-header>
          <mat-card-content>
            <p>
              旧版本仍有 <strong>{{ prompt.pendingMashSteps }}</strong> 个未完成糖化步、
              <strong>{{ prompt.activeFermentReadings }}</strong> 条未结束发酵读数
              @if (prompt.activeBatchNos.length) {
                （批次：<strong>{{ prompt.activeBatchNos.join('、') }}</strong>）
              }
              ，它们将继续绑定并按旧版本执行，不会被新版改写。确认后新版本才会投产、旧版本转为已停用。
            </p>
            <div class="prompt-actions">
              <button mat-button type="button" (click)="cancelActivate()">取消</button>
              <button mat-flat-button color="primary" type="button" (click)="confirmActivate(prompt.id)">
                确认影响并投产新版
              </button>
            </div>
          </mat-card-content>
        </mat-card>
      }

      @if (conflict(); as conflict) {
        <mat-card appearance="outlined" class="conflict-card">
          <mat-card-header><mat-card-title>配方已被其他窗口更新（保存未生效）</mat-card-title></mat-card-header>
          <mat-card-content>
            <p class="muted">
              本窗口打开的是 v{{ conflictBaseVersionNo() }}，最新版本已是
              v{{ conflict.latestVersion.versionNo }}。请对照下列冲突字段，刷新到最新版本后重新编辑：
            </p>
            @if (conflict.conflicts.length === 0) {
              <p>本次修改不涉及版本判定字段或已与最新值一致；请直接基于最新版本重新打开编辑。</p>
            } @else {
              <table class="data-table">
                <thead>
                  <tr>
                    <th>冲突字段</th>
                    <th>本窗口基线值</th>
                    <th>本窗口填写值</th>
                    <th>最新版本值</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of conflict.conflicts; track c.field) {
                    <tr>
                      <td><strong>{{ c.label }}</strong></td>
                      <td>{{ c.baseValue }}</td>
                      <td class="conflict-attempt">{{ c.attemptedValue }}</td>
                      <td class="conflict-latest">{{ c.latestValue }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
            <div class="prompt-actions">
              <button mat-button type="button" (click)="dismissConflict()">关闭</button>
              <button mat-flat-button color="primary" type="button" (click)="openLatestAfterConflict()">
                基于最新版本 v{{ conflict.latestVersion.versionNo }} 重新编辑
              </button>
            </div>
          </mat-card-content>
        </mat-card>
      }

      @if (formVisible) {
        <mat-card appearance="outlined">
          <mat-card-header>
            <mat-card-title>{{ formTitle() }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            @if (editState()?.base; as base) {
              <p class="muted">
                当前基于 <strong>v{{ base.versionNo }}（{{ base.status }}）</strong> 编辑：
                改风格 / 目标指标 / 批次体积会封存当前版本并生成新版本；只改名称或发酵计划则在当前版本更新。
              </p>
            }
            <div class="form-grid">
              <mat-form-field appearance="outline">
                <mat-label>配方名称</mat-label>
                <input matInput [(ngModel)]="editValues.name" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>风格</mat-label>
                <mat-select [(ngModel)]="editValues.style">
                  @for (style of beerStyles; track style) {
                    <mat-option [value]="style">{{ style }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>目标 OG</mat-label>
                <input matInput type="number" step="0.001" [(ngModel)]="editValues.targetOg" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>目标 FG</mat-label>
                <input matInput type="number" step="0.001" [(ngModel)]="editValues.targetFg" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>目标 IBU</mat-label>
                <input matInput type="number" [(ngModel)]="editValues.targetIbu" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>目标 EBC</mat-label>
                <input matInput type="number" [(ngModel)]="editValues.targetEbc" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>批次体积 L</mat-label>
                <input matInput type="number" [(ngModel)]="editValues.batchSizeL" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>发酵计划：主发酵温度 ℃</mat-label>
                <input matInput type="number" step="0.1" [(ngModel)]="editValues.planPrimaryTempC" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>发酵计划：还原温度 ℃</mat-label>
                <input matInput type="number" step="0.1" [(ngModel)]="editValues.planDiacetylTempC" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>发酵计划：天数</mat-label>
                <input matInput type="number" [(ngModel)]="editValues.planDays" />
              </mat-form-field>
            </div>
          </mat-card-content>
          <mat-card-actions align="end">
            <button mat-button type="button" (click)="formVisible = false">取消</button>
            <button mat-flat-button color="primary" type="button" (click)="submit()">保存</button>
          </mat-card-actions>
        </mat-card>
      }
    </div>
  `,
  styles: [
    `
      .grid-series {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .version-table td,
      .version-table th {
        font-size: 12px;
        padding: 6px 8px;
      }
      .row--selected {
        background: #eef4e8;
      }
      .version-ops {
        white-space: nowrap;
        text-align: right;
      }
      .review-flag {
        background: #fbe6c8;
        color: #7a4a12;
        border-radius: 999px;
        padding: 1px 8px;
        font-size: 11px;
      }
      .series-meta {
        margin-top: 8px;
      }
      .prompt-card {
        border-color: #d68910;
      }
      .conflict-card {
        border-color: #c0392b;
      }
      .conflict-attempt {
        color: #c0392b;
      }
      .conflict-latest {
        color: #1e8449;
        font-weight: 600;
      }
      .prompt-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 8px;
      }
    `
  ]
})
export class RecipeListComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);
  private readonly actions$ = inject(Actions);
  private readonly destroyRef = inject(DestroyRef);

  readonly beerStyles = BEER_STYLES;
  readonly series = this.store.selectSignal(selectFilteredRecipeSeries);
  readonly filter = this.store.selectSignal(selectRecipeFilter);
  readonly selectedId = this.store.selectSignal(selectSelectedRecipeId);
  readonly selected = this.store.selectSignal(selectSelectedRecipe);
  readonly selectedSeries = this.store.selectSignal(selectSelectedSeries);
  readonly loading = this.store.selectSignal(selectRecipeLoading);
  readonly error = this.store.selectSignal(selectRecipeError);
  readonly conflict = this.store.selectSignal(selectSaveConflict);
  readonly activationPrompt = this.store.selectSignal(selectPendingActivation);

  private readonly allMalts = this.store.selectSignal(selectAllMalts);
  private readonly allMashSteps = this.store.selectSignal(selectAllMashSteps);
  private readonly allBoilAdds = this.store.selectSignal(selectAllBoilAdds);
  private readonly allFerments = this.store.selectSignal(selectAllFerments);
  private readonly allPackagings = this.store.selectSignal(selectAllPackagings);

  readonly selects: FilterSelectConfig[] = [
    { key: 'styles', label: '风格', options: BEER_STYLES.map((style) => ({ label: style, value: style })) }
  ];

  formVisible = false;
  readonly editState = signal<EditState | null>(null);
  editValues: RecipeFormValues = createEmptyRecipe();

  readonly versionCount = computed(
    () => this.series().reduce((sum, item) => sum + item.versions.length, 0)
  );
  readonly draftCount = computed(
    () =>
      this.series().reduce(
        (sum, item) => sum + item.versions.filter((version) => version.status === '待复核').length,
        0
      )
  );
  readonly packagedSeriesCount = computed(
    () => new Set(this.allPackagings().map((item) => item.seriesId)).size
  );

  conflictBaseVersionNo(): number {
    const conflict = this.conflict();
    if (!conflict) return 0;
    const baseRow = this.allVersionRows().find((row) => row.id === conflict.baseId);
    return baseRow?.versionNo ?? conflict.latestVersion.versionNo - 1;
  }

  /** 展開全部版本行（冲突弹窗按 baseId 查基线版本号） */
  private readonly allVersionRows = computed(() => this.series().flatMap((item) => item.versions));

  formTitle(): string {
    return this.editState()?.base ? '编辑配方（工艺改动将生成新版本）' : '新建配方';
  }

  ngOnInit(): void {
    this.store.dispatch(RecipeActions.reloadAll());
    this.store.dispatch(RecipeActions.selectRecipe({ id: this.route.snapshot.queryParamMap.get('recipeId') }));
    const params: Record<string, string | undefined> = {};
    this.route.snapshot.queryParamMap.keys.forEach((key) => {
      params[key] = this.route.snapshot.queryParamMap.get(key) ?? undefined;
    });
    this.store.dispatch(RecipeActions.setFilter({ filter: queryParamsToFilters(params, ['styles']) }));

    // 本窗口保存的结果反馈：fork 出版本 / 冲突被拒（冲突弹窗同时列出字段）
    this.actions$
      .pipe(ofType(RecipeActions.saveRecipeSuccess), takeUntilDestroyed(this.destroyRef))
      .subscribe(({ result }) => {
        if (result.forked) {
          this.snack.open('已封存旧版并生成待复核新版本，待执行工序已复制', '去复核', { duration: 4000 });
        }
      });
    this.actions$
      .pipe(ofType(RecipeActions.saveRecipeConflict), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.snack.open('本窗口配方已过期，保存未生效', '查看冲突', { duration: 4000 });
      });
  }

  /* ------------------------------ 实绩指标 ------------------------------ */

  /** 某具体版本绑定的发酵首末读数（历史实绩不随新版改写） */
  private realized(_seriesId: string, versionId: string): { og: number; fg: number } {
    const rows = this.allFerments()
      .filter((item) => item.recipeId === versionId)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length === 0) return { og: 0, fg: 0 };
    return { og: rows[0].gravity, fg: rows[rows.length - 1].gravity };
  }

  realizedOg(seriesId: string, versionId: string): number {
    return this.realized(seriesId, versionId).og;
  }

  realizedFg(seriesId: string, versionId: string): number {
    return this.realized(seriesId, versionId).fg;
  }

  /** 系列实绩：跨版本合并全部历史读数的首末值 */
  private seriesRealized(item: RecipeSeries): { og: number; fg: number } {
    const rows = this.allFerments()
      .filter((reading) => reading.seriesId === item.seriesId)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length === 0) return { og: 0, fg: 0 };
    return { og: rows[0].gravity, fg: rows[rows.length - 1].gravity };
  }

  seriesAbv(item: RecipeSeries): number {
    const { og, fg } = this.seriesRealized(item);
    return abvFromGravity(og, fg);
  }

  seriesAttenuation(item: RecipeSeries): number {
    const { og, fg } = this.seriesRealized(item);
    return apparentAttenuation(og, fg);
  }

  grainKg(recipe: Recipe): number {
    return totalGrainKg(recipe.batchSizeL, recipe.targetOg);
  }

  ebcDelta(item: RecipeSeries): number {
    const malts = this.allMalts().filter((malt) => malt.recipeId === item.latest.id);
    if (malts.length === 0) return 0;
    return ebcDeviation(malts, item.latest.targetEbc);
  }

  /** 某版本复制过来、尚待复核的糖化步 + 煮沸投加条数 */
  reviewCount(versionId: string): number {
    const mash = this.allMashSteps().filter((step) => step.recipeId === versionId && step.needsReview).length;
    const adds = this.allBoilAdds().filter((add) => add.recipeId === versionId && add.needsReview).length;
    return mash + adds;
  }

  /* ------------------------------ 交互 ------------------------------ */

  select(id: string): void {
    this.store.dispatch(RecipeActions.selectRecipe({ id }));
  }

  openCreate(): void {
    this.editValues = createEmptyRecipe();
    this.editState.set({ base: null, values: this.editValues });
    this.formVisible = true;
  }

  edit(version: RecipeRow): void {
    this.editValues = {
      name: version.name,
      style: version.style,
      targetOg: version.targetOg,
      targetFg: version.targetFg,
      targetIbu: version.targetIbu,
      targetEbc: version.targetEbc,
      batchSizeL: version.batchSizeL,
      planPrimaryTempC: version.planPrimaryTempC,
      planDiacetylTempC: version.planDiacetylTempC,
      planDays: version.planDays,
      planNeedsReview: false
    };
    this.editState.set({ base: version, values: this.editValues });
    this.formVisible = true;
  }

  submit(): void {
    if (!this.editValues.name.trim()) {
      this.snack.open('请填写配方名称', '关闭', { duration: 2500 });
      return;
    }
    const state = this.editState();
    if (!state?.base) {
      this.store.dispatch(RecipeActions.createRecipe({ payload: { ...this.editValues } }));
      this.snack.open('配方 v1 已创建并投产', '关闭', { duration: 2200 });
    } else {
      this.store.dispatch(
        RecipeActions.saveRecipe({
          id: state.base.id,
          baseVersionNo: state.base.versionNo,
          baseUpdatedAt: state.base.updatedAt,
          values: { ...this.editValues }
        })
      );
      this.snack.open('保存请求已提交', '关闭', { duration: 1500 });
    }
    this.formVisible = false;
  }

  activate(id: string): void {
    // 先不带确认发起；若仍有在制批次，effect 会转成 blocked 并在页面展开影响确认
    this.store.dispatch(RecipeActions.activateVersion({ id, confirmImpact: false }));
  }

  confirmActivate(id: string): void {
    this.store.dispatch(RecipeActions.activateVersion({ id, confirmImpact: true }));
    this.snack.open('新版本已投产，旧版本已封存', '关闭', { duration: 2500 });
  }

  cancelActivate(): void {
    this.store.dispatch(RecipeActions.cancelActivate());
  }

  reviewAll(versionId: string): void {
    this.store.dispatch(RecipeActions.reviewAll({ recipeId: versionId }));
    this.snack.open('发酵计划与复制工序已全部复核通过', '关闭', { duration: 2000 });
  }

  reviewPlan(versionId: string): void {
    this.store.dispatch(RecipeActions.reviewPlan({ recipeId: versionId }));
    this.snack.open('发酵计划已复核通过', '关闭', { duration: 2000 });
  }

  dismissConflict(): void {
    // 通过切到任意版本清空 conflict 标记（selectRecipe 会清）
    this.store.dispatch(RecipeActions.selectRecipe({ id: this.selectedId() }));
  }

  openLatestAfterConflict(): void {
    const latest = this.conflict()?.latestVersion;
    if (!latest) return;
    this.store.dispatch(RecipeActions.selectRecipe({ id: latest.id }));
    this.edit(latest);
  }

  remove(item: RecipeSeries): void {
    if (
      !window.confirm(
        `删除配方「${item.name}」会删除其全部 ${item.versions.length} 个版本，并级联删除各版本的麦芽、酒花、糖化步、煮沸投加、发酵读数与罐装批次，是否继续？`
      )
    ) {
      return;
    }
    this.store.dispatch(RecipeActions.deleteRecipe({ id: item.latest.id }));
    this.snack.open('配方系列及其从属数据已删除', '关闭', { duration: 2500 });
  }

  onFilterChange(next: FilterModel): void {
    this.store.dispatch(RecipeActions.setFilter({ filter: next }));
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: filtersToQueryParams(next),
      replaceUrl: true
    });
  }

  onResetFilter(): void {
    this.store.dispatch(RecipeActions.resetFilter());
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }
}
