/** /recipes 配方与风格台账：不可变版本化（风格 / 目标 / 体积 / 配比变化即生成新版本），并发冲突列出冲突字段，切新版投产提示影响并等确认 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { FilterBarComponent } from '../../shared/components/filter-bar/filter-bar.component';
import { StatBadgeComponent } from '../../shared/components/stat-badge/stat-badge.component';
import { EmptyPanelComponent } from '../../shared/components/empty-panel/empty-panel.component';
import { StyleTagComponent } from '../../shared/components/style-tag/style-tag.component';
import { VersionBadgeComponent } from '../../shared/components/version-badge/version-badge.component';
import {
  BEER_STYLES,
  VERSION_DRIVEN_FIELDS,
  createEmptyRecipe,
  type Recipe,
  type RecipeDraft
} from '../../core/models/recipe.model';
import { filtersToQueryParams, queryParamsToFilters, type FilterModel, type FilterSelectConfig } from '../../core/models/filter.model';
import { RecipeActions } from '../../core/state/recipe/recipe.actions';
import {
  selectRecipeFamilies,
  selectRecipeError,
  selectRecipeFilter,
  selectRecipeLoading,
  selectSelectedRecipe,
  selectVersionConflict,
  selectVersionImpact,
  type RecipeFamilyGroup
} from '../../core/state/recipe/recipe.selectors';
import { selectAllMalts } from '../../core/state/ingredients/ingredients.selectors';
import { selectAllHops } from '../../core/state/ingredients/ingredients.selectors';
import { selectRealFerments } from '../../core/state/ferment/ferment.selectors';
import { selectAllPackagings } from '../../core/state/packaging/packaging.selectors';
import { abvFromGravity, apparentAttenuation, ebcDeviation, totalGrainKg } from '../../core/utils/brew';
import type { RecipeRow } from '../../core/utils/db';

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
    StyleTagComponent,
    VersionBadgeComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <div class="page__head">
        <div>
          <h2 class="page__title">配方与风格台账</h2>
          <p class="page__subtitle">
            正式配方按版本管理：风格 / 目标 / 体积 / 配比变化即生成不可变新版本，历史实绩绑定原版本不被改写。
          </p>
        </div>
        <button mat-flat-button color="primary" type="button" (click)="openCreate()">
          <mat-icon>add</mat-icon>
          新建配方
        </button>
      </div>

      <div class="badge-row">
        <app-stat-badge label="配方家族" [value]="families().length" suffix="个" tone="primary" icon="menu_book" />
        <app-stat-badge label="待复核版本" [value]="pendingCount()" suffix="个" tone="warning" icon="fact_check" />
        <app-stat-badge label="平均目标 IBU" [value]="avgTargetIbu()" suffix="IBU" tone="warning" icon="bolt" />
        <app-stat-badge label="已罐装配方" [value]="packagedRecipeCount()" suffix="个" tone="success" icon="inventory_2" />
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

      @if (families().length === 0) {
        <app-empty-panel
          title="还没有匹配的配方"
          description="新建一个糖化配方，再为它配置麦芽、酒花与糖化升温步。"
          createText="新建配方"
          (create)="openCreate()"
        ></app-empty-panel>
      } @else {
        <div class="grid-cards">
          @for (group of families(); track group.familyId) {
            <mat-card
              appearance="outlined"
              [style.border-color]="group.pending ? '#e0b64f' : group.latest.id === selected()?.id ? '#3f6b3a' : null"
            >
              <mat-card-header>
                <mat-card-title>
                  {{ group.name }}
                  <app-version-badge [versionNo]="group.latest.versionNo" [state]="group.latest.versionState"></app-version-badge>
                </mat-card-title>
                <mat-card-subtitle>
                  <app-style-tag [value]="group.latest.style"></app-style-tag>
                  <span class="muted">批次 {{ group.latest.batchSizeL }} L</span>
                  @if (group.pending) {
                    <span class="pending-hint">有新版本待复核投产</span>
                  }
                </mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                <table class="data-table">
                  <tbody>
                    <tr>
                      <th>目标 OG / FG</th>
                      <td>{{ group.latest.targetOg }} / {{ group.latest.targetFg }}</td>
                    </tr>
                    <tr>
                      <th>目标 IBU / EBC</th>
                      <td>{{ group.latest.targetIbu }} / {{ group.latest.targetEbc }}</td>
                    </tr>
                    <tr>
                      <th>实绩 OG / FG</th>
                      <td>{{ realizedOg(group.latest.id) }} / {{ realizedFg(group.latest.id) }}</td>
                    </tr>
                    <tr>
                      <th>实绩 ABV / 发酵度</th>
                      <td>{{ realizedAbv(group.latest.id) }} %vol / {{ realizedAttenuation(group.latest.id) }} %</td>
                    </tr>
                    <tr>
                      <th>色度偏差</th>
                      <td [style.color]="ebcDelta(group.latest) < 0 ? '#c0392b' : '#1e8449'">
                        {{ ebcDelta(group.latest) > 0 ? '+' : '' }}{{ ebcDelta(group.latest) }} EBC
                      </td>
                    </tr>
                    <tr>
                      <th>投料量</th>
                      <td>{{ grainKg(group.latest) }} kg · 麦芽 {{ maltCount(group.latest.id) }} 条</td>
                    </tr>
                  </tbody>
                </table>
              </mat-card-content>
              <mat-card-actions align="end">
                <button mat-button type="button" (click)="selectFamily(group)">设为当前</button>
                <button mat-button type="button" (click)="edit(group.latest)">编辑</button>
                @if (group.hasHistory) {
                  <button mat-button type="button" (click)="openHistory(group)">版本历史</button>
                }
                @if (group.pending) {
                  <button mat-flat-button color="primary" type="button" (click)="activate(group.pending)">启用投产</button>
                }
                <button mat-button color="warn" type="button" (click)="remove(group)">删除</button>
              </mat-card-actions>
            </mat-card>
          }
        </div>
      }

      @if (formVisible) {
        <mat-card appearance="outlined">
          <mat-card-header>
            <mat-card-title>
              {{ editingId ? '编辑配方（将生成新版本）' : '新建配方' }}
            </mat-card-title>
          </mat-card-header>
          <mat-card-content>
            @if (editingId) {
              <p class="version-note">
                <mat-icon>info</mat-icon>
                风格 / 目标指标 / 批次体积 / 原料配比变化会生成不可变新版本；待执行糖化步、煮沸投加与发酵计划将复制到新版并标记待复核，已完成工序与历史实绩保留在原版本。
              </p>
            }
            <div class="form-grid">
              <mat-form-field appearance="outline">
                <mat-label>配方名称</mat-label>
                <input matInput [(ngModel)]="form.name" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>风格</mat-label>
                <mat-select [(ngModel)]="form.style">
                  @for (style of beerStyles; track style) {
                    <mat-option [value]="style">{{ style }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>目标 OG</mat-label>
                <input matInput type="number" step="0.001" [(ngModel)]="form.targetOg" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>目标 FG</mat-label>
                <input matInput type="number" step="0.001" [(ngModel)]="form.targetFg" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>目标 IBU</mat-label>
                <input matInput type="number" [(ngModel)]="form.targetIbu" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>目标 EBC</mat-label>
                <input matInput type="number" [(ngModel)]="form.targetEbc" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>批次体积 L</mat-label>
                <input matInput type="number" [(ngModel)]="form.batchSizeL" />
              </mat-form-field>
            </div>

            @if (editingId && versionMalts().length > 0) {
              <div class="ratio-editor">
                <h4>原料配比（随新版本生效）</h4>
                <div class="ratio-grid">
                  @for (malt of versionMalts(); track malt.id) {
                    <mat-form-field appearance="outline" class="ratio-field">
                      <mat-label>麦芽「{{ malt.name }}」占比 %</mat-label>
                      <input matInput type="number" [(ngModel)]="ratioDrafts[malt.id]" />
                    </mat-form-field>
                  }
                  @for (hop of versionHops(); track hop.id) {
                    <mat-form-field appearance="outline" class="ratio-field">
                      <mat-label>酒花「{{ hop.name }}」用量 g</mat-label>
                      <input matInput type="number" [(ngModel)]="hopDrafts[hop.id]" />
                    </mat-form-field>
                  }
                </div>
              </div>
            }
          </mat-card-content>
          <mat-card-actions align="end">
            <button mat-button type="button" (click)="formVisible = false">取消</button>
            <button mat-flat-button color="primary" type="button" (click)="submit()">
              {{ editingId ? '保存为新版本' : '保存' }}
            </button>
          </mat-card-actions>
        </mat-card>
      }

      @if (conflict()) {
        <mat-card appearance="outlined" class="dialog-panel">
          <mat-card-header>
            <mat-card-title>
              <mat-icon color="warn">warning</mat-icon>
              配方已被其他窗口修改
            </mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="muted">
              您正在编辑的版本已不是最新版本（其他窗口已保存更新）。以下为最新版本相对您所见版本的冲突字段：
            </p>
            <table class="data-table">
              <thead>
                <tr><th>字段</th><th>您所见版本</th><th>最新版本</th></tr>
              </thead>
              <tbody>
                @for (c of conflict()!.conflicts; track c.field) {
                  <tr>
                    <td>{{ c.label }}</td>
                    <td>{{ c.baseValue }}</td>
                    <td class="conflict-latest">{{ c.latestValue }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </mat-card-content>
          <mat-card-actions align="end">
            <button mat-button type="button" (click)="dismissConflict()">取消</button>
            <button mat-flat-button color="primary" type="button" (click)="rebaseOnLatest()">基于最新版本重新编辑</button>
          </mat-card-actions>
        </mat-card>
      }

      @if (impact()) {
        <mat-card appearance="outlined" class="dialog-panel">
          <mat-card-header>
            <mat-card-title>
              <mat-icon color="warn">factory</mat-icon>
              切新版投产将影响未结束批次
            </mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="muted">
              有 <strong>{{ impact()!.impact.unfinishedBatches.length }}</strong> 个未结束批次仍引用旧版。启用新版后：
            </p>
            <ul class="impact-list">
              <li>这些批次的待执行糖化步、煮沸投加已复制到新版并标记 <strong>待复核</strong>；</li>
              <li>后续发酵读数将按新版标准记录；</li>
              <li>历史发酵读数与罐装批次<strong>继续绑定旧版</strong>，实绩不被改写。</li>
            </ul>
            <table class="data-table">
              <thead>
                <tr><th>批次号</th><th>阶段</th><th>最近比重</th><th>最近日期</th></tr>
              </thead>
              <tbody>
                @for (b of impact()!.impact.unfinishedBatches; track b.batchNo) {
                  <tr>
                    <td>{{ b.batchNo }}</td>
                    <td><app-style-tag [value]="b.state"></app-style-tag></td>
                    <td>{{ b.gravity }}</td>
                    <td>{{ b.date }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </mat-card-content>
          <mat-card-actions align="end">
            <button mat-button type="button" (click)="dismissImpact()">取消</button>
            <button mat-flat-button color="primary" type="button" (click)="confirmActivate()">确认投产</button>
          </mat-card-actions>
        </mat-card>
      }

      @if (historyFamily()) {
        <mat-card appearance="outlined" class="dialog-panel">
          <mat-card-header>
            <mat-card-title>版本历史 · {{ historyFamily()!.name }}</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <table class="data-table">
              <thead>
                <tr><th>版本</th><th>状态</th><th>风格</th><th>目标 OG / FG</th><th>目标 IBU / EBC</th><th>批次体积</th></tr>
              </thead>
              <tbody>
                @for (v of historyFamily()!.versions; track v.id) {
                  <tr>
                    <td><app-version-badge [versionNo]="v.versionNo" [state]="v.versionState"></app-version-badge></td>
                    <td>{{ v.versionState }}</td>
                    <td>{{ v.style }}</td>
                    <td>{{ v.targetOg }} / {{ v.targetFg }}</td>
                    <td>{{ v.targetIbu }} / {{ v.targetEbc }}</td>
                    <td>{{ v.batchSizeL }} L</td>
                  </tr>
                }
              </tbody>
            </table>
            <p class="muted">历史版本只读：已完成工序、发酵读数与罐装批次均绑定到对应版本，不因新版发布而改写。</p>
          </mat-card-content>
          <mat-card-actions align="end">
            <button mat-flat-button color="primary" type="button" (click)="historyFamily.set(null)">关闭</button>
          </mat-card-actions>
        </mat-card>
      }
    </div>
  `,
  styles: [
    `
      .pending-hint {
        margin-left: 8px;
        font-size: 12px;
        color: #b9770e;
        background: #fbe6c8;
        border-radius: 999px;
        padding: 2px 10px;
      }
      .version-note {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 13px;
        color: #5a6a55;
        background: #f3f4ee;
        border-radius: 8px;
        padding: 10px 12px;
        margin: 0 0 16px;
      }
      .version-note mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .ratio-editor {
        margin-top: 16px;
        border-top: 1px dashed var(--brew-border, #d8d8cf);
        padding-top: 12px;
      }
      .ratio-editor h4 {
        margin: 0 0 10px;
        color: #3f6b3a;
      }
      .ratio-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;
      }
      .ratio-field {
        width: 100%;
      }
      .dialog-panel {
        margin-top: 16px;
        border: 1px solid #e0b64f;
      }
      .conflict-latest {
        color: #b9770e;
        font-weight: 600;
      }
      .impact-list {
        margin: 8px 0 16px;
        padding-left: 20px;
        color: #5a6a55;
        font-size: 13px;
      }
      .impact-list li {
        margin: 4px 0;
      }
    `
  ]
})
export class RecipeListComponent implements OnInit {
  private readonly store = inject(Store);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);

  readonly beerStyles = BEER_STYLES;
  readonly families = this.store.selectSignal(selectRecipeFamilies);
  readonly filter = this.store.selectSignal(selectRecipeFilter);
  readonly selected = this.store.selectSignal(selectSelectedRecipe);
  readonly loading = this.store.selectSignal(selectRecipeLoading);
  readonly error = this.store.selectSignal(selectRecipeError);
  readonly conflict = this.store.selectSignal(selectVersionConflict);
  readonly impact = this.store.selectSignal(selectVersionImpact);

  private readonly allMalts = this.store.selectSignal(selectAllMalts);
  private readonly allHops = this.store.selectSignal(selectAllHops);
  private readonly allFerments = this.store.selectSignal(selectRealFerments);
  private readonly allPackagings = this.store.selectSignal(selectAllPackagings);

  formVisible = false;
  editingId: string | null = null;
  form: RecipeDraft = createEmptyRecipe();
  /** 正在编辑版本的原料配比草稿（随新版本生效） */
  ratioDrafts: Record<string, number> = {};
  hopDrafts: Record<string, number> = {};

  /** 版本历史弹窗当前展示的家族 */
  readonly historyFamily = signal<RecipeFamilyGroup | null>(null);

  readonly selects: FilterSelectConfig[] = [
    { key: 'styles', label: '风格', options: BEER_STYLES.map((style) => ({ label: style, value: style })) }
  ];

  readonly pendingCount = computed(() => this.families().filter((g) => g.pending).length);

  /** 编辑中版本的麦芽 / 酒花（供配比编辑器） */
  readonly versionMalts = computed(() =>
    this.editingId ? this.allMalts().filter((m) => m.recipeId === this.editingId) : []
  );
  readonly versionHops = computed(() =>
    this.editingId ? this.allHops().filter((h) => h.recipeId === this.editingId) : []
  );

  readonly avgTargetIbu = computed(() => {
    const list = this.families().map((g) => g.latest);
    return list.length === 0 ? 0 : Math.round(list.reduce((sum, item) => sum + item.targetIbu, 0) / list.length);
  });

  readonly avgTargetOg = computed(() => {
    const list = this.families().map((g) => g.latest);
    return list.length === 0 ? 0 : Number((list.reduce((sum, item) => sum + item.targetOg, 0) / list.length).toFixed(3));
  });

  readonly packagedRecipeCount = computed(
    () => new Set(this.allPackagings().map((item) => item.recipeId)).size
  );

  ngOnInit(): void {
    this.store.dispatch(RecipeActions.reloadAll());
    this.store.dispatch(RecipeActions.selectRecipe({ id: this.route.snapshot.queryParamMap.get('recipeId') }));
    const params: Record<string, string | undefined> = {};
    this.route.snapshot.queryParamMap.keys.forEach((key) => {
      params[key] = this.route.snapshot.queryParamMap.get(key) ?? undefined;
    });
    this.store.dispatch(RecipeActions.setFilter({ filter: queryParamsToFilters(params, ['styles']) }));
  }

  /** 实际发酵首末读数（仅真实读数，排除计划标记） */
  private realized(recipeId: string): { og: number; fg: number } {
    const rows = this.allFerments()
      .filter((item) => item.recipeId === recipeId)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length === 0) return { og: 0, fg: 0 };
    return { og: rows[0].gravity, fg: rows[rows.length - 1].gravity };
  }

  realizedOg(recipeId: string): number {
    return this.realized(recipeId).og;
  }

  realizedFg(recipeId: string): number {
    return this.realized(recipeId).fg;
  }

  realizedAbv(recipeId: string): number {
    const { og, fg } = this.realized(recipeId);
    return abvFromGravity(og, fg);
  }

  realizedAttenuation(recipeId: string): number {
    const { og, fg } = this.realized(recipeId);
    return apparentAttenuation(og, fg);
  }

  maltCount(recipeId: string): number {
    return this.allMalts().filter((item) => item.recipeId === recipeId).length;
  }

  grainKg(recipe: Recipe): number {
    return totalGrainKg(recipe.batchSizeL, recipe.targetOg);
  }

  ebcDelta(recipe: Recipe): number {
    const malts = this.allMalts().filter((item) => item.recipeId === recipe.id);
    if (malts.length === 0) return 0;
    return ebcDeviation(malts, recipe.targetEbc);
  }

  /** 选中某家族的生效版本（其他页面绑定到当前生产版本） */
  selectFamily(group: RecipeFamilyGroup): void {
    this.store.dispatch(RecipeActions.selectRecipe({ id: group.active.id }));
  }

  openCreate(): void {
    this.editingId = null;
    this.form = createEmptyRecipe();
    this.ratioDrafts = {};
    this.hopDrafts = {};
    this.formVisible = true;
  }

  edit(recipe: RecipeRow): void {
    this.editingId = recipe.id;
    this.form = {
      name: recipe.name,
      style: recipe.style,
      targetOg: recipe.targetOg,
      targetFg: recipe.targetFg,
      targetIbu: recipe.targetIbu,
      targetEbc: recipe.targetEbc,
      batchSizeL: recipe.batchSizeL
    };
    // 初始化原料配比草稿
    this.ratioDrafts = {};
    for (const m of this.allMalts().filter((item) => item.recipeId === recipe.id)) {
      this.ratioDrafts[m.id] = m.ratioPct;
    }
    this.hopDrafts = {};
    for (const h of this.allHops().filter((item) => item.recipeId === recipe.id)) {
      this.hopDrafts[h.id] = h.amountG;
    }
    this.formVisible = true;
  }

  /** 判断版本驱动字段或原料配比是否发生变化 */
  private hasVersionDrivenChange(base: RecipeRow): boolean {
    for (const field of VERSION_DRIVEN_FIELDS) {
      if (String(base[field]) !== String(this.form[field])) return true;
    }
    for (const m of this.allMalts().filter((item) => item.recipeId === base.id)) {
      if (this.ratioDrafts[m.id] !== undefined && Number(this.ratioDrafts[m.id]) !== Number(m.ratioPct)) return true;
    }
    for (const h of this.allHops().filter((item) => item.recipeId === base.id)) {
      if (this.hopDrafts[h.id] !== undefined && Number(this.hopDrafts[h.id]) !== Number(h.amountG)) return true;
    }
    return false;
  }

  submit(): void {
    if (!this.form.name.trim()) {
      this.snack.open('请填写配方名称', '关闭', { duration: 2500 });
      return;
    }
    if (this.editingId) {
      const base = this.families()
        .flatMap((g) => g.versions)
        .find((v) => v.id === this.editingId);
      if (base && this.hasVersionDrivenChange(base)) {
        // 生成不可变新版本
        const maltRatios: Record<string, number> = {};
        for (const m of this.versionMalts()) {
          if (this.ratioDrafts[m.id] !== undefined) maltRatios[m.id] = Number(this.ratioDrafts[m.id]);
        }
        const hopAmounts: Record<string, number> = {};
        for (const h of this.versionHops()) {
          if (this.hopDrafts[h.id] !== undefined) hopAmounts[h.id] = Number(this.hopDrafts[h.id]);
        }
        this.store.dispatch(
          RecipeActions.createRecipeVersion({
            baseVersionId: this.editingId,
            payload: { ...this.form },
            maltRatios,
            hopAmounts
          })
        );
        this.snack.open('已生成新版本，待复核投产后生效', '关闭', { duration: 2500 });
      } else {
        // 仅名称等非版本驱动字段变化：原地更新当前版本
        this.store.dispatch(RecipeActions.updateRecipe({ id: this.editingId, patch: { ...this.form } }));
        this.snack.open('配方已保存', '关闭', { duration: 2000 });
      }
    } else {
      this.store.dispatch(RecipeActions.createRecipe({ payload: { ...this.form } }));
      this.snack.open('配方已保存', '关闭', { duration: 2000 });
    }
    this.formVisible = false;
  }

  /** 启用新版投产（先经影响评估，有未结束批次时弹影响窗等确认） */
  activate(version: RecipeRow): void {
    this.store.dispatch(RecipeActions.activateRecipeVersion({ versionId: version.id, confirmImpact: false }));
  }

  confirmActivate(): void {
    const impact = this.impact();
    if (!impact) return;
    this.store.dispatch(RecipeActions.activateRecipeVersion({ versionId: impact.versionId, confirmImpact: true }));
  }

  dismissConflict(): void {
    this.store.dispatch(RecipeActions.dismissVersionConflict());
  }

  dismissImpact(): void {
    this.store.dispatch(RecipeActions.dismissVersionImpact());
  }

  /** 基于最新版本重新编辑：关闭冲突窗，以最新版值填充表单 */
  rebaseOnLatest(): void {
    const conflict = this.conflict();
    if (!conflict) return;
    const latest = this.families()
      .flatMap((g) => g.versions)
      .find((v) => v.id === conflict.latestVersionId);
    this.store.dispatch(RecipeActions.dismissVersionConflict());
    if (latest) {
      this.edit(latest);
      this.snack.open('已基于最新版本重新编辑', '关闭', { duration: 2200 });
    }
  }

  openHistory(group: RecipeFamilyGroup): void {
    this.historyFamily.set(group);
  }

  remove(group: RecipeFamilyGroup): void {
    if (
      !window.confirm(
        `删除配方家族「${group.name}」将级联删除其全部 ${group.versions.length} 个版本及各版本的麦芽、酒花、糖化步、煮沸投加、发酵读数与罐装批次，是否继续？`
      )
    ) {
      return;
    }
    this.store.dispatch(RecipeActions.deleteRecipe({ id: group.latest.id }));
    this.snack.open('配方家族及其从属数据已删除', '关闭', { duration: 2500 });
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
