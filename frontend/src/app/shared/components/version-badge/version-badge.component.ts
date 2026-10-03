/**
 * 版本徽标：展示配方版本号与生命周期状态（生效中 / 待复核 / 已归档）。
 * 被配方台账、糖化编排、煮沸投加、发酵跟踪、罐装登记等页面消费。
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import type { RecipeVersionState } from '../../../core/models/recipe.model';

@Component({
  selector: 'app-version-badge',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="version-badge" [class]="'version-badge--' + state">
      <span class="version-badge__no">v{{ versionNo }}</span>
      <span class="version-badge__state">{{ state }}</span>
    </span>
  `,
  styles: [
    `
      .version-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border-radius: 999px;
        padding: 2px 10px;
        font-size: 12px;
        font-weight: 600;
        line-height: 1.6;
      }
      .version-badge__no {
        opacity: 0.75;
      }
      .version-badge--生效中 {
        background: #e2f0d9;
        color: #2f5a24;
      }
      .version-badge--待复核 {
        background: #fbe6c8;
        color: #7a4a12;
      }
      .version-badge--已归档 {
        background: #e6e6e6;
        color: #6f7a68;
      }
    `
  ]
})
export class VersionBadgeComponent {
  @Input({ required: true }) versionNo = 1;
  @Input({ required: true }) state: RecipeVersionState = '生效中';
}
