export type Composition = "棉" | "涤纶" | "锦纶" | "混纺";

export type DyeClass = "活性" | "分散" | "酸性" | "直接";

export interface RecipeItem {
  /** 染料名称（隐含染料类别，如「分散深蓝HGL」） */
  dye: string;
  /** 配方占比 % */
  ratio: number;
}

export interface CurvePoint {
  /** 相对开工时间（分钟） */
  minute: number;
  /** 该时刻染浴温度（℃） */
  temp: number;
}

export type ReviewStatus = "评审通过" | "待复染" | "客户确认中";

export interface Batch {
  /** 小样批次号，如 LAB-620A */
  id: string;
  /** 客户订单号 */
  orderNo: string;
  customer: string;
  /** 织物名称，如 棉府绸 */
  fabricName: string;
  /** 面料成分（大类） */
  composition: Composition;
  /** 克重 g/m² */
  weight: number;
  recipe: RecipeItem[];
  /** 浴比 1 : liquorRatio */
  liquorRatio: number;
  /** 保温时间（分钟） */
  holdMinutes: number;
  /** 温度曲线 */
  curve: CurvePoint[];
  /** 后整理方式 */
  finish: string;
  /** Lab 对色结果 ΔL / Δa / Δb */
  dl: number;
  da: number;
  db: number;
  status: ReviewStatus;
  note?: string;
}
