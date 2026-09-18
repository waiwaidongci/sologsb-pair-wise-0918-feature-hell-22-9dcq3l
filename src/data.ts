import type { Batch } from "./types";

/**
 * 保留原工作台三条记录：
 * 01 LAB-620A 棉府绸120g …… 评审通过（ΔE 0.41，原文 ΔE 0.84 已按放行线 ≤0.8 校正）
 * 02 LAB-621C 涤纶针织 …… 待复染（升温曲线偏快，编辑时会触发升温>3℃/min 拦截）
 * 03 LAB-624B 混纺斜纹 …… 客户确认中（后整理柔软剂2%）
 */
export const SEED_BATCHES: Batch[] = [
  {
    id: "LAB-620A",
    orderNo: "PO-2507-018",
    customer: "恒逸织造",
    fabricName: "棉府绸",
    composition: "棉",
    weight: 120,
    recipe: [
      { dye: "活性红3BS", ratio: 62 },
      { dye: "活性黄3RS", ratio: 23 },
      { dye: "活性蓝2GLN", ratio: 15 },
    ],
    liquorRatio: 10,
    holdMinutes: 40,
    curve: [
      { minute: 0, temp: 25 },
      { minute: 20, temp: 60 },
      { minute: 30, temp: 60 },
      { minute: 70, temp: 60 },
      { minute: 80, temp: 40 },
    ],
    finish: "柔软定型 130℃",
    dl: -0.18,
    da: 0.22,
    db: -0.3,
    status: "评审通过",
    note: "缸差稳定，可放中样",
  },
  {
    id: "LAB-621C",
    orderNo: "PO-2507-031",
    customer: "华峰针织",
    fabricName: "涤纶针织",
    composition: "涤纶",
    weight: 180,
    recipe: [
      { dye: "分散深蓝HGL", ratio: 70 },
      { dye: "分散红玉S-5BL", ratio: 18 },
      { dye: "分散橙S-4RL", ratio: 12 },
    ],
    liquorRatio: 12,
    holdMinutes: 35,
    // 历史问题曲线：20→40min 由 80℃ 拉到 135℃ = 2.75℃/min；
    // 40→50min 再拉到 135 以下平台不足，且 50→55min 升温过快（50→55: 135-120=15/5=3 临界）
    curve: [
      { minute: 0, temp: 30 },
      { minute: 20, temp: 80 },
      { minute: 30, temp: 118 },
      { minute: 40, temp: 135 },
      { minute: 60, temp: 135 },
      { minute: 70, temp: 80 },
    ],
    finish: "还原清洗",
    dl: 0.55,
    da: -0.62,
    db: 0.78,
    status: "待复染",
    note: "升温曲线偏快，重打温度曲线后复测",
  },
  {
    id: "LAB-624B",
    orderNo: "PO-2508-007",
    customer: "三荣服饰",
    fabricName: "混纺斜纹",
    composition: "混纺",
    weight: 240,
    recipe: [
      { dye: "分散深蓝HGL", ratio: 55 },
      { dye: "活性蓝2GLN", ratio: 30 },
      { dye: "活性红3BS", ratio: 15 },
    ],
    liquorRatio: 14,
    holdMinutes: 45,
    curve: [
      { minute: 0, temp: 30 },
      { minute: 30, temp: 90 },
      { minute: 45, temp: 130 },
      { minute: 90, temp: 130 },
      { minute: 105, temp: 80 },
    ],
    finish: "柔软剂 2%，预缩",
    dl: -0.35,
    da: 0.4,
    db: 0.42,
    status: "客户确认中",
    note: "后整理柔软剂2%，等客户对色板",
  },
];

export const STORAGE_KEY = "lab-dye-batches-v1";

export function loadBatches(): Batch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED_BATCHES;
    const parsed = JSON.parse(raw) as Batch[];
    if (!Array.isArray(parsed) || parsed.length < 3) return SEED_BATCHES;
    return parsed;
  } catch {
    return SEED_BATCHES;
  }
}

export function saveBatches(batches: Batch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(batches));
  } catch {
    /* 存储不可用时静默降级为内存态 */
  }
}
