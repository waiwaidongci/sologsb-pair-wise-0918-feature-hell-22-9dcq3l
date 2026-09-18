import type { Batch, CurvePoint, DyeClass } from "./types";
import { dyeClassOf, EXPECTED_DYE_CLASS, TEMP_WINDOW } from "./catalog";

/** 评审放行阈值：ΔE 必须 ≤ 0.8 */
export const DELTA_E_LIMIT = 0.8;
/** 最大允许升温速率：3 ℃/min */
export const MAX_RAMP = 3;
/** 配方合计允许误差（百分点） */
export const RATIO_TOLERANCE = 0.01;

export type FieldKey =
  | "id"
  | "orderNo"
  | "weight"
  | "recipe"
  | "liquorRatio"
  | "holdMinutes"
  | "curve"
  | "dl"
  | "da"
  | "db"
  | "status";

export type ErrorMap = Partial<Record<FieldKey, string>>;

export function deltaE(dl: number, da: number, db: number): number {
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** ΔE 判级：越小越好，0.8 为评审放行线 */
export function deltaEGrade(de: number): { grade: number; label: string } {
  if (de <= 0.3) return { grade: 5, label: "5级 · 极微" };
  if (de <= 0.5) return { grade: 4.5, label: "4-5级 · 轻微" };
  if (de <= 0.8) return { grade: 4, label: "4级 · 可接受" };
  if (de <= 1.2) return { grade: 3.5, label: "3-4级 · 偏差" };
  if (de <= 2) return { grade: 3, label: "3级 · 明显" };
  return { grade: 2, label: "2级及以下 · 不合格" };
}

/** 曲线解析：最高温、各升温段最大速率、保温平台时长 */
export function analyzeCurve(curve: CurvePoint[]): {
  maxTemp: number;
  maxRamp: number;
  rampDetail: string;
  /** 最高温（±2℃）持续时长，分钟 */
  topHold: number;
  topTemp: number;
} {
  const sorted = [...curve].sort((a, b) => a.minute - b.minute);
  let maxTemp = 0;
  let maxRamp = 0;
  const rampSegs: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const dtMin = sorted[i].minute - sorted[i - 1].minute;
    const dTemp = sorted[i].temp - sorted[i - 1].temp;
    maxTemp = Math.max(maxTemp, sorted[i].temp);
    if (dtMin > 0 && dTemp > 0) {
      const ramp = dTemp / dtMin;
      if (ramp > maxRamp) maxRamp = ramp;
      rampSegs.push(`${sorted[i - 1].minute}→${sorted[i].minute}min：${ramp.toFixed(2)}℃/min`);
    }
  }
  if (sorted.length > 0) maxTemp = Math.max(maxTemp, sorted[0].temp);

  // 统计最高温平台（与最高温差 ≤ 2℃ 视为保温段）
  const topTemp = maxTemp;
  let topHold = 0;
  for (let i = 1; i < sorted.length; i++) {
    const dtMin = sorted[i].minute - sorted[i - 1].minute;
    if (
      dtMin > 0 &&
      Math.abs(sorted[i - 1].temp - topTemp) <= 2 &&
      Math.abs(sorted[i].temp - topTemp) <= 2
    ) {
      topHold += dtMin;
    }
  }
  return { maxTemp, maxRamp, rampDetail: rampSegs.join("；") || "无升温段", topHold, topTemp };
}

/** 浴比是否在克重适配区间（克重越大建议偏小浴比） */
export function liquorRatioRange(weight: number): [number, number] {
  if (weight < 100) return [8, 15];
  if (weight <= 180) return [10, 20];
  return [12, 25];
}

/**
 * 联动校验：返回 字段 -> 原因 的错误映射；为空表示可以保存。
 * existingIds 用于批次号查重。
 */
export function validateBatch(batch: Batch, existingIds: string[] = []): ErrorMap {
  const err: ErrorMap = {};

  if (!batch.id.trim()) {
    err.id = "批次号不能为空";
  } else if (!/^LAB-\d{3}[A-Z]$/.test(batch.id.trim())) {
    err.id = "批次号格式应为 LAB-三位数字+字母，如 LAB-625A";
  } else if (existingIds.includes(batch.id.trim())) {
    err.id = "该批次号已存在，请更换";
  }

  if (!batch.orderNo.trim()) {
    err.orderNo = "请填写客户订单号，才能按订单筛选";
  }

  if (!batch.weight || batch.weight <= 0) {
    err.weight = "克重必须大于 0";
  } else if (batch.weight < 40 || batch.weight > 600) {
    err.weight = `克重 ${batch.weight} g/m² 超出常见机织/针织范围（40–600），请确认`;
  }

  // —— 配方占比合计必须为 100（允许 0.01 浮点误差）——
  const items = batch.recipe.filter((r) => r.dye.trim() !== "" && r.ratio > 0);
  if (items.length === 0) {
    err.recipe = "至少填写一条染料配方";
  } else {
    const total = items.reduce((s, r) => s + r.ratio, 0);
    const parts: string[] = [];
    if (Math.abs(total - 100) > RATIO_TOLERANCE) {
      parts.push(`配方占比合计为 ${total.toFixed(2)}%，偏离 100%，请按 ${(100 - total >= 0 ? "+" : "")}${(100 - total).toFixed(2)} 调整`);
    }
    const dupDyes = new Set<string>();
    const seen = new Set<string>();
    items.forEach((r) => {
      if (seen.has(r.dye)) dupDyes.add(r.dye);
      seen.add(r.dye);
    });
    if (dupDyes.size > 0) parts.push(`染料重复：${[...dupDyes].join("、")}`);

    // —— 面料成分 × 染料类别 联动 ——
    const classes = new Set<DyeClass>();
    items.forEach((r) => {
      const c = dyeClassOf(r.dye);
      if (c) classes.add(c);
    });
    const expected = EXPECTED_DYE_CLASS[batch.composition];
    if (expected) {
      const wrong = [...classes].filter((c) => c !== expected);
      if (wrong.length > 0 || classes.size === 0) {
        parts.push(
          `${batch.composition}面料应使用${expected}染料（当前：${[...classes].join("、") || "未识别类别"}），成分与配方不匹配`
        );
      }
    } else {
      if (classes.size < 2) {
        parts.push(
          `混纺成分须含两类及以上染料以匹配不同纤维（当前仅：${[...classes].join("、") || "无"}）`
        );
      }
    }
    if (parts.length) err.recipe = parts.join("；");
  }

  // —— 克重 × 浴比 联动 ——
  if (!batch.liquorRatio || batch.liquorRatio <= 0) {
    err.liquorRatio = "浴比必须大于 0";
  } else {
    const [lo, hi] = liquorRatioRange(batch.weight || 0);
    if (batch.liquorRatio < lo || batch.liquorRatio > hi) {
      err.liquorRatio = `浴比 1:${batch.liquorRatio} 与克重 ${batch.weight}g/m² 不匹配，建议区间 1:${lo}–1:${hi}`;
    }
  }

  // —— 保温时间 ——
  if (!batch.holdMinutes || batch.holdMinutes <= 0) {
    err.holdMinutes = "保温时间必须大于 0";
  } else if (batch.holdMinutes < 10 || batch.holdMinutes > 90) {
    err.holdMinutes = `保温 ${batch.holdMinutes} 分钟超出常规范围（10–90min），请确认`;
  }

  // —— 温度曲线 ——
  const sorted = [...batch.curve].sort((a, b) => a.minute - b.minute);
  const curveMsgs: string[] = [];
  if (sorted.length < 2) {
    curveMsgs.push("温度曲线至少需要 2 个控制点");
  } else {
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].minute <= sorted[i - 1].minute) {
        curveMsgs.push(`第 ${i + 1} 个点的时间必须严格递增`);
        break;
      }
    }
  }
  const info = analyzeCurve(batch.curve);
  if (sorted.length >= 2) {
    // 升温速率 ≤ 3 ℃/min
    if (info.maxRamp > MAX_RAMP + 1e-9) {
      curveMsgs.push(
        `存在 ${info.maxRamp.toFixed(2)}℃/min 的升温段（${info.rampDetail}），超过上限 ${MAX_RAMP}℃/min，请放慢升温`
      );
    }
    // 成分 × 最高染色温度 联动
    const [lo, hi] = TEMP_WINDOW[batch.composition];
    if (info.maxTemp < lo || info.maxTemp > hi) {
      curveMsgs.push(
        `${batch.composition}面料染色温度应在 ${lo}–${hi}℃，曲线最高温 ${info.maxTemp}℃ 与之不符`
      );
    }
    // 保温时间 × 曲线平台 联动
    if (batch.holdMinutes > 0) {
      if (info.topHold <= 0) {
        curveMsgs.push(
          `曲线在最高温 ${info.topTemp}℃ 处没有保温平台，无法覆盖 ${batch.holdMinutes} 分钟保温要求`
        );
      } else if (info.topHold + 1 < batch.holdMinutes) {
        curveMsgs.push(
          `曲线最高温平台仅 ${info.topHold} 分钟，与保温时间 ${batch.holdMinutes} 分钟不符（差 ${batch.holdMinutes - info.topHold} 分钟）`
        );
      }
    }
  }
  if (curveMsgs.length) err.curve = curveMsgs.join("；");

  // —— Lab 色差 ——
  for (const [k, v, label] of [
    ["dl", batch.dl, "ΔL"],
    ["da", batch.da, "Δa"],
    ["db", batch.db, "Δb"],
  ] as [FieldKey, number, string][]) {
    if (Number.isNaN(v) || Math.abs(v) > 10) {
      err[k] = `${label} 应为 -10 ～ 10 之间的实测值`;
    }
  }
  const de = deltaE(batch.dl || 0, batch.da || 0, batch.db || 0);
  if (batch.status === "评审通过" && de > DELTA_E_LIMIT) {
    err.status = `ΔE = ${de.toFixed(2)} 超过 ${DELTA_E_LIMIT}，不能通过评审；可保存为「待复染」`;
  }

  return err;
}
