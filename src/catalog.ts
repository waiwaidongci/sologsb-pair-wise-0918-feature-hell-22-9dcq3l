import type { Composition, DyeClass } from "./types";

export const COMPOSITIONS: Composition[] = ["棉", "涤纶", "锦纶", "混纺"];

export const DYE_CATALOG: { name: string; cls: DyeClass }[] = [
  { name: "活性红3BS", cls: "活性" },
  { name: "活性黄3RS", cls: "活性" },
  { name: "活性蓝2GLN", cls: "活性" },
  { name: "分散红玉S-5BL", cls: "分散" },
  { name: "分散深蓝HGL", cls: "分散" },
  { name: "分散橙S-4RL", cls: "分散" },
  { name: "酸性大红GR", cls: "酸性" },
  { name: "酸性黄N-CTL", cls: "酸性" },
  { name: "酸性蓝N-GF", cls: "酸性" },
  { name: "直接耐晒黑G", cls: "直接" },
];

export function dyeClassOf(dye: string): DyeClass | null {
  const hit = DYE_CATALOG.find((d) => d.name === dye);
  if (hit) return hit.cls;
  if (dye.startsWith("活性")) return "活性";
  if (dye.startsWith("分散")) return "分散";
  if (dye.startsWith("酸性")) return "酸性";
  if (dye.startsWith("直接")) return "直接";
  return null;
}

/** 各成分允许的最高染色温度区间（℃），用于与温度曲线联动校验 */
export const TEMP_WINDOW: Record<Composition, [number, number]> = {
  棉: [55, 100],
  涤纶: [125, 140],
  锦纶: [95, 105],
  混纺: [100, 135],
};

/** 成分与染料类别的适配关系（null 表示至少两类） */
export const EXPECTED_DYE_CLASS: Record<Composition, DyeClass | null> = {
  棉: "活性",
  涤纶: "分散",
  锦纶: "酸性",
  混纺: null,
};
