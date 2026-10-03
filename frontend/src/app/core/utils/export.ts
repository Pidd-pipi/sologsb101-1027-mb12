/**
 * 配方 JSON 序列化与校验
 * 罐装页用于导出配方实绩档案，也是「导入导出备份」的数据校验入口。
 * 档案按配方系列导出：包含全部不可变版本；发酵读数与罐装实绩按绑定版本分组，历史实绩不被新版改写。
 */
import type { Recipe } from '../models/recipe.model';
import type { Malt } from '../models/malt.model';
import type { Hop } from '../models/hop.model';
import type { MashStep } from '../models/mash-step.model';
import type { BoilAdd } from '../models/boil-add.model';
import type { Ferment } from '../models/ferment.model';
import type { Packaging } from '../models/packaging.model';
import { DB_NAME, DB_SCHEMA_VERSION, db } from './db';
import { abvFromGravity, apparentAttenuation, totalGrainKg, weightedEbc } from './brew';
import { nowIso } from './uuid';

/** 配方实绩档案（按系列归档，含全部历史版本） */
export interface RecipeArchive {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  /** 系列 id（同一款酒的全部版本共享） */
  seriesId: string;
  /** 全部不可变版本（按版本号升序） */
  versions: Recipe[];
  malts: Malt[];
  hops: Hop[];
  mashSteps: MashStep[];
  boilAdds: BoilAdd[];
  ferments: Ferment[];
  packagings: Packaging[];
  summary: {
    versionCount: number;
    maltCount: number;
    hopCount: number;
    mashStepCount: number;
    boilAddCount: number;
    fermentCount: number;
    grainKg: number;
    avgEbc: number;
    og: number;
    fg: number;
    abv: number;
    attenuation: number;
    packagedQuantity: number;
  };
}

type WithRevision = { revision?: number; createdAt?: number; updatedAt?: number };

function stripRevision<T extends WithRevision>(row: T): T {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.revision;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy as T;
}

/**
 * 汇总某个配方系列的实绩档案。
 * 传入任意版本行 id，均按其 seriesId 导出全部版本与各版本绑定的实绩。
 */
export async function buildRecipeArchive(recipeId: string): Promise<RecipeArchive> {
  const anchor = await db.recipes.get(recipeId);
  if (!anchor) throw new Error('配方不存在，无法导出档案');
  const series = (await db.recipes.where('seriesId').equals(anchor.seriesId).toArray()).sort(
    (a, b) => a.versionNo - b.versionNo
  );
  const versionIds = series.map((item) => item.id);
  const latest = series[series.length - 1];
  const [malts, hops, mashSteps, boilAdds, ferments, packagings] = await Promise.all([
    db.malts.where('recipeId').anyOf(versionIds).toArray(),
    db.hops.where('recipeId').anyOf(versionIds).toArray(),
    db.mashSteps.where('recipeId').anyOf(versionIds).toArray(),
    db.boilAdds.where('recipeId').anyOf(versionIds).toArray(),
    db.ferments.where('seriesId').equals(anchor.seriesId).toArray(),
    db.packagings.where('seriesId').equals(anchor.seriesId).toArray()
  ]);
  const sortedFerments = [...ferments].sort((a, b) => a.date.localeCompare(b.date));
  // 实绩首末值按系列内全部历史读数合并（每批读数仍各自保留 recipeId / recipeVersionNo 留痕）
  const og = sortedFerments.length > 0 ? sortedFerments[0].gravity : latest.targetOg;
  const fg = sortedFerments.length > 0 ? sortedFerments[sortedFerments.length - 1].gravity : latest.targetFg;
  const latestMalts = malts.filter((item) => item.recipeId === latest.id);

  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    seriesId: anchor.seriesId,
    versions: series.map(stripRevision),
    malts: malts.map(stripRevision),
    hops: hops.map(stripRevision),
    mashSteps: mashSteps.map(stripRevision),
    boilAdds: boilAdds.map(stripRevision),
    ferments: sortedFerments.map(stripRevision),
    packagings: packagings.map(stripRevision),
    summary: {
      versionCount: series.length,
      maltCount: malts.length,
      hopCount: hops.length,
      mashStepCount: mashSteps.length,
      boilAddCount: boilAdds.length,
      fermentCount: ferments.length,
      grainKg: totalGrainKg(latest.batchSizeL, latest.targetOg),
      avgEbc: weightedEbc(latestMalts),
      og,
      fg,
      abv: abvFromGravity(og, fg),
      attenuation: apparentAttenuation(og, fg),
      packagedQuantity: packagings.reduce((sum, item) => sum + item.quantity, 0)
    }
  };
}

export function serializeArchive(archive: RecipeArchive): string {
  return JSON.stringify(archive, null, 2);
}

/** 校验并解析档案 / 备份 JSON，失败时抛出可读错误 */
export function parseArchive(text: string): RecipeArchive {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文本');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('档案根节点必须是对象');
  }
  const candidate = parsed as Partial<RecipeArchive>;
  if (typeof candidate.name !== 'string') throw new Error('缺少 name 字段');
  if (typeof candidate.schemaVersion !== 'number') throw new Error('缺少 schemaVersion 字段');
  // 兼容旧版档案的 recipe 单对象字段；新版档案为 versions 数组
  const hasVersions = Array.isArray(candidate.versions) && candidate.versions.length > 0;
  const legacyRecipe = (candidate as unknown as { recipe?: Recipe }).recipe;
  if (!hasVersions && (!legacyRecipe || typeof legacyRecipe.id !== 'string')) {
    throw new Error('缺少 versions 版本数组（或旧版 recipe.id 字段）');
  }
  if (!Array.isArray(candidate.malts)) throw new Error('malts 必须是数组');
  return candidate as RecipeArchive;
}

/** 触发浏览器下载（纯前端，无需后端） */
export function downloadJson(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
