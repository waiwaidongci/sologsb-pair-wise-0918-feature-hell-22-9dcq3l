import { useMemo, useRef, useState } from "react";
import "./styles.css";

/* ============================ 类型定义 ============================ */

type ReviewStatus = "passed" | "pending" | "redye" | "confirming";

interface FiberRow {
  uid: number;
  type: string;
  percent: string;
}
interface RecipeRow {
  uid: number;
  name: string;
  percent: string;
}
interface CurveRow {
  uid: number;
  t: string;
  temp: string;
}
interface LabRow {
  l: string;
  a: string;
  b: string;
}

interface Batch {
  id: string;
  customer: string;
  orderNo: string;
  fabricName: string;
  fibers: { type: string; percent: number }[];
  weight: number;
  recipe: { name: string; percent: number }[];
  bathRatio: number;
  curve: { t: number; temp: number }[];
  holdMin: number;
  finishing: string;
  targetLab: { l: number; a: number; b: number };
  sampleLab: { l: number; a: number; b: number };
  status: ReviewStatus;
  remark: string;
  updatedAt: string;
}

interface Draft {
  id: string;
  customer: string;
  orderNo: string;
  fabricName: string;
  weight: string;
  bathRatio: string;
  holdMin: string;
  finishing: string;
  fibers: FiberRow[];
  recipe: RecipeRow[];
  curve: CurveRow[];
  target: LabRow;
  sample: LabRow;
  remark: string;
}

/* ============================ 常量与工具 ============================ */

const FIBER_OPTIONS = ["棉", "涤纶", "锦纶", "腈纶", "羊毛", "粘胶", "氨纶"];
const TOL = 0.01; // 百分比 / 温度的浮点容差

const STATUS_META: Record<ReviewStatus, { label: string; cls: string }> = {
  passed: { label: "评审通过", cls: "st-passed" },
  pending: { label: "待评审", cls: "st-pending" },
  redye: { label: "待复染", cls: "st-redye" },
  confirming: { label: "客户确认中", cls: "st-confirming" },
};

let uidSeq = 100;
const nextUid = () => ++uidSeq;

const num = (s: string) => {
  if (s.trim() === "") return NaN;
  return Number(s);
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const clampPct = (s: string) => (s.trim() === "" ? "—" : `${round2(Number(s))}%`);

/** 由成分行推导成分分类：单一纤维≥90% 记为该成分，否则为混纺 */
function fiberCategory(fibers: { type: string; percent: number }[]): string {
  const valid = fibers.filter((f) => f.type.trim() !== "" && f.percent > 0);
  if (valid.length === 0) return "未知";
  const total = valid.reduce((s, f) => s + f.percent, 0);
  if (total <= 0) return "未知";
  const top = [...valid].sort((a, b) => b.percent - a.percent)[0];
  if (top.percent / total >= 0.9) return top.type;
  return "混纺";
}

function deltaE(
  t: { l: number; a: number; b: number },
  s: { l: number; a: number; b: number }
): number {
  return Math.sqrt(
    (s.l - t.l) ** 2 + (s.a - t.a) ** 2 + (s.b - t.b) ** 2
  );
}

/** 色差 -> 变色灰卡级别（GB/T 250 / ISO 105-A02 思路） */
function gradeOf(de: number): string {
  if (de <= 0.2) return "5级";
  if (de <= 0.5) return "4-5级";
  if (de <= 0.8) return "4级";
  if (de <= 1.5) return "3-4级";
  if (de <= 3.0) return "3级";
  return "2-3级";
}

const PASS_LIMIT = 0.8;
const MAX_RAMP = 3;

/* ---------- 温度曲线推导 ---------- */

interface CurveStat {
  maxRamp: number; // 最大升温速率 ℃/min（仅升温段）
  maxTemp: number;
  plateau: number; // 最高温平台时长 min
  ramps: { index: number; rate: number }[];
  monotone: boolean;
}

function analyzeCurve(points: { t: number; temp: number }[]): CurveStat | null {
  if (points.length < 2) return null;
  let monotone = true;
  for (let i = 1; i < points.length; i++) {
    if (!(points[i].t > points[i - 1].t)) monotone = false;
  }
  const maxTemp = Math.max(...points.map((p) => p.temp));
  const ramps: { index: number; rate: number }[] = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    const dT = points[i].temp - points[i - 1].temp;
    if (dt > 0 && dT > 0) {
      ramps.push({ index: i, rate: dT / dt });
    }
  }
  const maxRamp = ramps.length ? Math.max(...ramps.map((r) => r.rate)) : 0;
  // 最高温（±0.5℃）连续点构成的保温平台，取跨度最大的一段
  let plateau = 0;
  let runStart = -1;
  points.forEach((p, i) => {
    if (Math.abs(p.temp - maxTemp) <= 0.5) {
      if (runStart < 0) runStart = i;
      plateau = Math.max(plateau, p.t - points[runStart].t);
    } else {
      runStart = -1;
    }
  });
  return { maxRamp, maxTemp, plateau, ramps, monotone };
}

/* ---------- 配方条颜色 ---------- */

function dyeColor(name: string, fallbackIndex: number): string {
  const palette = ["#16a34a", "#0891b2", "#7c3aed", "#db2777", "#65a30d", "#ea580c"];
  if (name.includes("红")) return "#be123c";
  if (name.includes("黄")) return "#d97706";
  if (name.includes("蓝")) return "#4f46e5";
  if (name.includes("黑")) return "#334155";
  if (name.includes("橙")) return "#ea580c";
  return palette[fallbackIndex % palette.length];
}

/* ============================ 初始三条记录（保留原数据） ============================ */

const INITIAL_BATCHES: Batch[] = [
  {
    id: "LAB-620A",
    customer: "华信纺织",
    orderNo: "SO-26081",
    fabricName: "棉府绸",
    fibers: [{ type: "棉", percent: 100 }],
    weight: 120,
    recipe: [
      { name: "活性红HE-3B", percent: 45 },
      { name: "活性黄HE-4R", percent: 35 },
      { name: "活性蓝HE-GN", percent: 20 },
    ],
    bathRatio: 12,
    curve: [
      { t: 0, temp: 25 },
      { t: 15, temp: 70 },
      { t: 25, temp: 95 },
      { t: 60, temp: 95 },
      { t: 70, temp: 60 },
    ],
    holdMin: 35,
    finishing: "柔软剂1%",
    targetLab: { l: 72, a: 12, b: -18 },
    sampleLab: { l: 72.4, a: 12.4, b: -17.6 },
    status: "passed",
    remark: "ΔE 0.69，评审通过",
    updatedAt: "2026-09-12",
  },
  {
    id: "LAB-621C",
    customer: "远东针织",
    orderNo: "SO-26105",
    fabricName: "涤纶针织",
    fibers: [{ type: "涤纶", percent: 100 }],
    weight: 160,
    recipe: [
      { name: "分散红FB", percent: 55 },
      { name: "分散蓝2BLN", percent: 45 },
    ],
    bathRatio: 15,
    curve: [
      { t: 0, temp: 30 },
      { t: 20, temp: 90 },
      { t: 35, temp: 130 },
      { t: 70, temp: 130 },
      { t: 90, temp: 70 },
    ],
    holdMin: 35,
    finishing: "定型170℃×45s",
    targetLab: { l: 45, a: 38, b: -8 },
    sampleLab: { l: 45.6, a: 38.7, b: -8.5 },
    status: "redye",
    remark: "历史小样升温偏快，待复染",
    updatedAt: "2026-09-13",
  },
  {
    id: "LAB-624B",
    customer: "鼎天服饰",
    orderNo: "SO-26132",
    fabricName: "混纺斜纹",
    fibers: [
      { type: "棉", percent: 60 },
      { type: "涤纶", percent: 40 },
    ],
    weight: 240,
    recipe: [
      { name: "活性红HE-3B", percent: 40 },
      { name: "分散红FB", percent: 30 },
      { name: "分散黄E-3G", percent: 30 },
    ],
    bathRatio: 10,
    curve: [
      { t: 0, temp: 30 },
      { t: 15, temp: 75 },
      { t: 30, temp: 110 },
      { t: 65, temp: 110 },
      { t: 80, temp: 65 },
    ],
    holdMin: 35,
    finishing: "柔软剂2%",
    targetLab: { l: 60, a: 5, b: 25 },
    sampleLab: { l: 60.3, a: 4.6, b: 24.7 },
    status: "confirming",
    remark: "后整理柔软剂2%，客户确认中",
    updatedAt: "2026-09-15",
  },
];

/* ============================ 表单联动校验 ============================ */

interface ValidationResult {
  errors: Partial<Record<string, string>>;
  warnings: Partial<Record<string, string>>;
  parsed: {
    fibers: { type: string; percent: number }[];
    recipe: { name: string; percent: number }[];
    curve: { t: number; temp: number }[];
    weight: number;
    bathRatio: number;
    holdMin: number;
    target: { l: number; a: number; b: number };
    sample: { l: number; a: number; b: number };
    fiberSum: number;
    recipeSum: number;
    category: string;
    de: number;
    stat: CurveStat;
  } | null;
}

function validate(d: Draft, knownIds: string[], editingId: string | null): ValidationResult {
  const errors: ValidationResult["errors"] = {};
  const warnings: ValidationResult["warnings"] = {};

  /* ---- 基础字段 ---- */
  if (!d.id.trim()) errors.id = "请填写批次号";
  else if (knownIds.some((x) => x === d.id.trim() && x !== editingId))
    errors.id = `批次号 ${d.id} 已存在，不能重复保存`;
  if (!d.customer.trim()) errors.customer = "请填写客户名称";
  if (!d.orderNo.trim()) errors.orderNo = "请填写客户订单号";
  if (!d.fabricName.trim()) errors.fabricName = "请填写面料名称";

  const weight = num(d.weight);
  if (Number.isNaN(weight) || weight <= 0) errors.weight = "克重需为大于0的数字（g/m²）";

  const bathRatio = num(d.bathRatio);
  if (Number.isNaN(bathRatio) || bathRatio <= 0)
    errors.bathRatio = "浴比需为大于0的数字（1:N 中的 N）";

  const holdMin = num(d.holdMin);
  if (Number.isNaN(holdMin) || holdMin <= 0) errors.hold = "保温时间需为大于0的数字（min）";

  /* ---- 面料成分 ---- */
  const fibers = d.fibers.map((f) => ({ type: f.type.trim(), percent: num(f.percent) }));
  let fiberSum = NaN;
  if (fibers.some((f) => f.type === "")) errors.fibers = "每种成分都要选择纤维类型";
  else if (fibers.some((f) => Number.isNaN(f.percent) || f.percent <= 0))
    errors.fibers = "成分百分比需为大于0的数字";
  else {
    fiberSum = round2(fibers.reduce((s, f) => s + f.percent, 0));
    if (Math.abs(fiberSum - 100) > TOL) {
      const diff = round2(100 - fiberSum);
      errors.fibers = `成分合计 ${fiberSum}%，偏离100%（还差${Math.abs(diff)}%${
        diff > 0 ? "未分配" : "超出"
      }），不能保存`;
    }
  }

  /* ---- 配方比例 ---- */
  const recipe = d.recipe.map((r) => ({ name: r.name.trim(), percent: num(r.percent) }));
  let recipeSum = NaN;
  if (recipe.length === 0) errors.recipe = "至少填写一条染料配方";
  else if (recipe.some((r) => r.name === "")) errors.recipe = "每条染料都要填写名称";
  else if (recipe.some((r) => Number.isNaN(r.percent) || r.percent <= 0))
    errors.recipe = "配方占比需为大于0的数字";
  else {
    recipeSum = round2(recipe.reduce((s, r) => s + r.percent, 0));
    if (Math.abs(recipeSum - 100) > TOL) {
      const diff = round2(100 - recipeSum);
      errors.recipe = `配方占比合计 ${recipeSum}%，偏离100%（差${Math.abs(diff)}%${
        diff > 0 ? "未分配" : "超出"
      }），不能保存`;
    }
  }

  /* ---- 温度曲线 ---- */
  const curve = d.curve.map((c) => ({ t: num(c.t), temp: num(c.temp) }));
  let stat: CurveStat | null = null;
  if (curve.length < 2) errors.curve = "温度曲线至少需要2个时间-温度点";
  else if (curve.some((c) => Number.isNaN(c.t) || Number.isNaN(c.temp)))
    errors.curve = "曲线点的时间与温度都必须是数字";
  else {
    stat = analyzeCurve(curve);
    if (!stat!.monotone)
      errors.curve = "曲线时间必须严格递增（后一点时间要大于前一点），不能保存";
    else {
      const bad = stat!.ramps.find((r) => r.rate > MAX_RAMP + TOL);
      if (bad) {
        errors.curve = `第${bad.index}段升温 ${round2(bad.rate)}℃/min，超过每分钟${MAX_RAMP}℃上限，不能保存`;
      }
    }
  }

  /* ---- 保温时间 × 曲线联动 ---- */
  if (!Number.isNaN(holdMin) && holdMin > 0 && stat && stat.monotone) {
    if (stat.plateau + TOL < holdMin) {
      errors.hold = `保温时间${round2(holdMin)}min，但曲线在最高温${round2(
        stat.maxTemp
      )}℃的平台仅${round2(stat.plateau)}min，保温时间与温度曲线不符，不能保存`;
    }
  }

  /* ---- Lab ---- */
  const parseLab = (row: LabRow, keyPrefix: string) => {
    const l = num(row.l);
    const a = num(row.a);
    const b = num(row.b);
    if ([l, a, b].some((v) => Number.isNaN(v)))
      errors[keyPrefix] = "L、a、b 三个值都必须填写数字";
    return { l, a, b };
  };
  const target = parseLab(d.target, "target");
  const sample = parseLab(d.sample, "sample");
  const de =
    Object.keys(errors).some((k) => k === "target" || k === "sample")
      ? NaN
      : round2(deltaE(target, sample));

  /* ---- 联动软提示（不阻断保存） ---- */
  const category = !Number.isNaN(fiberSum) ? fiberCategory(fibers) : "未知";
  if (!errors.weight && !Number.isNaN(fiberSum)) {
    const range: Record<string, [number, number]> = {
      棉: [60, 320],
      涤纶: [60, 260],
      锦纶: [50, 250],
      混纺: [70, 380],
    };
    const r = range[category];
    if (r && (weight < r[0] || weight > r[1]))
      warnings.weight = `${category}面料克重常见区间 ${r[0]}–${r[1]}g/m²，请确认克重与成分是否匹配`;
  }
  if (!errors.bathRatio && (bathRatio < 5 || bathRatio > 25))
    warnings.bathRatio = "浴比常见范围 1:5 – 1:25，请结合成分与设备确认";
  const polyester = fibers
    .filter((f) => f.type === "涤纶" && !Number.isNaN(f.percent))
    .reduce((s, f) => s + f.percent, 0);
  if (stat && polyester / Math.max(fiberSum, 1) >= 0.5 && stat.maxTemp < 120 - TOL)
    warnings.curve = `涤纶占比${round2(polyester)}%，分散染料高温染色建议最高温≥120℃`;
  if (!errors.hold && (holdMin < 15 || holdMin > 60))
    warnings.hold = "保温时间常见区间 15–60min，请确认工艺要求";

  const parsed =
    Object.keys(errors).length === 0
      ? {
          fibers,
          recipe,
          curve,
          weight,
          bathRatio,
          holdMin,
          target,
          sample,
          fiberSum,
          recipeSum,
          stat: stat!,
          category,
          de,
        }
      : null;

  return { errors, warnings, parsed };
}

/* ============================ 空白表单 / 记录回填 ============================ */

function emptyDraft(suggestId: string): Draft {
  return {
    id: suggestId,
    customer: "",
    orderNo: "",
    fabricName: "",
    weight: "",
    bathRatio: "",
    holdMin: "",
    finishing: "",
    fibers: [{ uid: nextUid(), type: "棉", percent: "" }],
    recipe: [{ uid: nextUid(), name: "", percent: "" }],
    curve: [
      { uid: nextUid(), t: "0", temp: "" },
      { uid: nextUid(), t: "", temp: "" },
    ],
    target: { l: "", a: "", b: "" },
    sample: { l: "", a: "", b: "" },
    remark: "",
  };
}

function batchToDraft(b: Batch): Draft {
  return {
    id: b.id,
    customer: b.customer,
    orderNo: b.orderNo,
    fabricName: b.fabricName,
    weight: String(b.weight),
    bathRatio: String(b.bathRatio),
    holdMin: String(b.holdMin),
    finishing: b.finishing,
    fibers: b.fibers.map((f) => ({ uid: nextUid(), type: f.type, percent: String(f.percent) })),
    recipe: b.recipe.map((r) => ({ uid: nextUid(), name: r.name, percent: String(r.percent) })),
    curve: b.curve.map((c) => ({ uid: nextUid(), t: String(c.t), temp: String(c.temp) })),
    target: { l: String(b.targetLab.l), a: String(b.targetLab.a), b: String(b.targetLab.b) },
    sample: { l: String(b.sampleLab.l), a: String(b.sampleLab.a), b: String(b.sampleLab.b) },
    remark: b.remark,
  };
}

/* ============================ 小组件 ============================ */

function FieldNote({ error, warning, hint }: { error?: string; warning?: string; hint?: string }) {
  if (error) return <small className="note note-err">✕ {error}</small>;
  if (warning) return <small className="note note-warn">⚠ {warning}</small>;
  if (hint) return <small className="note note-ok">✓ {hint}</small>;
  return null;
}

function Sparkline({ points }: { points: { t: number; temp: number }[] }) {
  const w = 150;
  const h = 40;
  if (points.length < 2) return null;
  const tMax = Math.max(...points.map((p) => p.t));
  const tmp = points.map((p) => p.temp);
  const TMin = Math.min(...tmp);
  const TMax = Math.max(...tmp);
  const xy = points.map((p) => {
    const x = (p.t / tMax) * (w - 6) + 3;
    const y = h - 4 - ((p.temp - TMin) / Math.max(TMax - TMin, 1)) * (h - 10);
    return [round2(x), round2(y)] as const;
  });
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={xy.map((p) => p.join(",")).join(" ")} fill="none" stroke="#4f46e5" strokeWidth={1.8} />
      {xy.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2} fill="#be123c" />
      ))}
    </svg>
  );
}

/* ============================ 主应用 ============================ */

export default function App() {
  const [batches, setBatches] = useState<Batch[]>(INITIAL_BATCHES);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft("LAB-625A"));
  const [submitted, setSubmitted] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const [keyword, setKeyword] = useState("");
  const [chip, setChip] = useState("全部");

  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  };

  /* -------- 表单实时联动结果 -------- */
  const v = useMemo(
    () => validate(draft, batches.map((b) => b.id), editingId),
    [draft, batches, editingId]
  );

  /* -------- 列表筛选 -------- */
  const enriched = useMemo(
    () =>
      batches.map((b) => {
        const de = round2(deltaE(b.targetLab, b.sampleLab));
        return { ...b, de, grade: gradeOf(de), category: fiberCategory(b.fibers) };
      }),
    [batches]
  );

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return enriched.filter((b) => {
      if (chip !== "全部" && b.category !== chip) return false;
      if (!kw) return true;
      return [b.id, b.customer, b.orderNo, b.fabricName, b.remark]
        .join(" ")
        .toLowerCase()
        .includes(kw);
    });
  }, [enriched, keyword, chip]);

  const categories = ["全部", "棉", "涤纶", "锦纶", "混纺"];

  /* -------- 指标 -------- */
  const overLimit = batches.filter(
    (b) => deltaE(b.targetLab, b.sampleLab) > PASS_LIMIT
  ).length;
  const orderCount = new Set(batches.map((b) => b.orderNo)).size;
  const passRate = batches.length
    ? Math.round((batches.filter((b) => b.status === "passed").length / batches.length) * 100)
    : 0;

  /* -------- 表单更新辅助 -------- */
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const updateFiber = (uid: number, patch: Partial<FiberRow>) =>
    setDraft((d) => ({
      ...d,
      fibers: d.fibers.map((f) => (f.uid === uid ? { ...f, ...patch } : f)),
    }));
  const updateRecipe = (uid: number, patch: Partial<RecipeRow>) =>
    setDraft((d) => ({
      ...d,
      recipe: d.recipe.map((r) => (r.uid === uid ? { ...r, ...patch } : r)),
    }));
  const updateCurve = (uid: number, patch: Partial<CurveRow>) =>
    setDraft((d) => ({
      ...d,
      curve: d.curve.map((c) => (c.uid === uid ? { ...c, ...patch } : c)),
    }));

  const startNew = () => {
    const maxNo = batches.reduce((m, b) => {
      const n = Number(b.id.replace(/\D/g, "").slice(0, 3));
      return Number.isNaN(n) ? m : Math.max(m, n);
    }, 620);
    setEditingId(null);
    setSubmitted(false);
    setDraft(emptyDraft(`LAB-${maxNo + 1}A`));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startEdit = (b: Batch) => {
    setEditingId(b.id);
    setSubmitted(false);
    setDraft(batchToDraft(b));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  /* -------- 保存 -------- */
  const persist = (status: ReviewStatus): boolean => {
    setSubmitted(true);
    if (!v.parsed) {
      flash("存在联动校验错误，请按字段旁提示修正后再保存");
      return false;
    }
    const p = v.parsed;
    if (status === "passed" && p.de > PASS_LIMIT) {
      flash(`ΔE ${p.de} 超过 ${PASS_LIMIT}，不能通过评审，请存为待复染`);
      return false;
    }
    const batch: Batch = {
      id: draft.id.trim(),
      customer: draft.customer.trim(),
      orderNo: draft.orderNo.trim(),
      fabricName: draft.fabricName.trim(),
      fibers: p.fibers,
      weight: p.weight,
      recipe: p.recipe,
      bathRatio: p.bathRatio,
      curve: p.curve,
      holdMin: p.holdMin,
      finishing: draft.finishing.trim(),
      targetLab: p.target,
      sampleLab: p.sample,
      status,
      remark: draft.remark.trim(),
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    setBatches((list) => {
      const idx = list.findIndex((x) => x.id === batch.id);
      if (idx >= 0) {
        const copy = [...list];
        copy[idx] = batch;
        return copy;
      }
      return [batch, ...list];
    });
    setEditingId(batch.id);
    setSubmitted(false);
    flash(`${editingId && editingId === batch.id ? "已更新" : "已保存"}批次 ${batch.id}（${STATUS_META[status].label}）`);
    return true;
  };

  /* -------- 导出 CSV -------- */
  const exportCsv = () => {
    const header = [
      "批次号", "客户", "客户订单", "面料", "成分", "克重g/m²", "浴比1:N",
      "配方", "最高温℃", "保温min", "最大升温℃/min", "后整理", "ΔE", "评级", "评审状态", "备注",
    ];
    const rows = filtered.map((b) => {
      const stat = analyzeCurve(b.curve);
      return [
        b.id, b.customer, b.orderNo, b.fabricName,
        b.fibers.map((f) => `${f.type}${f.percent}%`).join("/"),
        b.weight, b.bathRatio,
        b.recipe.map((r) => `${r.name}${r.percent}%`).join("/"),
        stat ? round2(stat.maxTemp) : "", b.holdMin,
        stat ? round2(stat.maxRamp) : "",
        b.finishing, b.de, b.grade, STATUS_META[b.status].label, b.remark,
      ];
    });
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `小样批次_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const showErrors = submitted;
  const e = (k: string) => (showErrors ? v.errors[k] : undefined);
  const w = (k: string) => v.warnings[k];
  const liveDe = v.parsed ? v.parsed.de : NaN;

  return (
    <main className="app">
      {toast && <div className="toast">{toast}</div>}

      <section className="hero">
        <p>hxyfront-62012 · 纺织染整实验室 · Port 62012</p>
        <h1>小样工作台 · 批次管理</h1>
        <span>
          面料成分、克重、配方比例、浴比、保温时间与温度曲线联动校验：配方占比合计须为100%、升温不得超过3℃/min、保温时间须与曲线最高温平台一致，否则不能保存。
          Lab色差 ΔE 超过 0.8 不能通过评审，可存为待复染。
        </span>
      </section>

      <section className="metrics">
        <article><small>小样批次</small><strong>{batches.length}</strong></article>
        <article><small>色差超限（ΔE&gt;0.8）</small><strong className={overLimit ? "num-rose" : ""}>{overLimit}</strong></article>
        <article><small>客户订单</small><strong>{orderCount}</strong></article>
        <article><small>通过率</small><strong>{passRate}%</strong></article>
      </section>

      {/* ================= 新增 / 编辑表单 ================= */}
      <section className="panel form-panel">
        <div className="heading">
          <div>
            <p>专业字段 · 联动校验</p>
            <h2>{editingId ? `编辑批次 ${editingId}` : "新增小样批次"}</h2>
          </div>
          <div className="heading-actions">
            {editingId && <button onClick={startNew}>＋ 新增批次</button>}
            <button className="primary" onClick={() => persist("pending")}>
              {editingId ? "保存修改（待评审）" : "保存批次（待评审）"}
            </button>
          </div>
        </div>

        <div className="field-grid">
          <label className={e("id") ? "invalid" : ""}>
            <span>批次号</span>
            <input value={draft.id} onChange={(ev) => set("id", ev.target.value)} placeholder="如 LAB-625A" />
            <FieldNote error={e("id")} />
          </label>
          <label className={e("customer") ? "invalid" : ""}>
            <span>客户</span>
            <input value={draft.customer} onChange={(ev) => set("customer", ev.target.value)} placeholder="客户名称" />
            <FieldNote error={e("customer")} />
          </label>
          <label className={e("orderNo") ? "invalid" : ""}>
            <span>客户订单号</span>
            <input value={draft.orderNo} onChange={(ev) => set("orderNo", ev.target.value)} placeholder="如 SO-26180" />
            <FieldNote error={e("orderNo")} />
          </label>
          <label className={e("fabricName") ? "invalid" : ""}>
            <span>面料名称</span>
            <input value={draft.fabricName} onChange={(ev) => set("fabricName", ev.target.value)} placeholder="如 棉府绸" />
            <FieldNote error={e("fabricName")} />
          </label>
        </div>

        {/* 面料成分 */}
        <div className={"sub " + (e("fibers") ? "invalid-block" : "")}>
          <div className="sub-head">
            <h3>面料成分（%）</h3>
            <button type="button" onClick={() =>
              set("fibers", [...draft.fibers, { uid: nextUid(), type: "棉", percent: "" }])}>
              ＋ 添加成分
            </button>
          </div>
          <div className="rows">
            {draft.fibers.map((f) => (
              <div className="row" key={f.uid}>
                <select value={f.type} onChange={(ev) => updateFiber(f.uid, { type: ev.target.value })}>
                  {FIBER_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                </select>
                <input type="number" step="0.1" value={f.percent}
                  onChange={(ev) => updateFiber(f.uid, { percent: ev.target.value })} placeholder="占比 %" />
                <button type="button" className="ghost" disabled={draft.fibers.length === 1}
                  onClick={() => set("fibers", draft.fibers.filter((x) => x.uid !== f.uid))}>
                  删除
                </button>
              </div>
            ))}
          </div>
          <FieldNote
            error={e("fibers")}
            hint={!e("fibers") && v.parsed ? `成分合计 ${v.parsed.fiberSum}%，分类：${v.parsed.category}` : undefined}
          />
        </div>

        <div className="field-grid">
          <label className={e("weight") || w("weight") ? "invalid" : ""}>
            <span>克重（g/m²）</span>
            <input type="number" step="1" value={draft.weight}
              onChange={(ev) => set("weight", ev.target.value)} placeholder="如 120" />
            <FieldNote error={e("weight")} warning={w("weight")} />
          </label>
          <label className={e("bathRatio") || w("bathRatio") ? "invalid" : ""}>
            <span>浴比 1 : N</span>
            <input type="number" step="0.5" value={draft.bathRatio}
              onChange={(ev) => set("bathRatio", ev.target.value)} placeholder="N，如 12" />
            <FieldNote error={e("bathRatio")} warning={w("bathRatio")} />
          </label>
        </div>

        {/* 配方 */}
        <div className={"sub " + (e("recipe") ? "invalid-block" : "")}>
          <div className="sub-head">
            <h3>染料配方比例（占比合计须为 100%）</h3>
            <button type="button" onClick={() =>
              set("recipe", [...draft.recipe, { uid: nextUid(), name: "", percent: "" }])}>
              ＋ 添加染料
            </button>
          </div>
          <div className="rows">
            {draft.recipe.map((r) => (
              <div className="row" key={r.uid}>
                <input value={r.name} onChange={(ev) => updateRecipe(r.uid, { name: ev.target.value })}
                  placeholder="染料名称，如 活性红HE-3B" />
                <input type="number" step="0.1" value={r.percent}
                  onChange={(ev) => updateRecipe(r.uid, { percent: ev.target.value })} placeholder="占比 %" />
                <button type="button" className="ghost" disabled={draft.recipe.length === 1}
                  onClick={() => set("recipe", draft.recipe.filter((x) => x.uid !== r.uid))}>
                  删除
                </button>
              </div>
            ))}
          </div>
          <FieldNote
            error={e("recipe")}
            hint={!e("recipe") && v.parsed ? `配方占比合计 ${v.parsed.recipeSum}%` : undefined}
          />
        </div>

        {/* 温度曲线 */}
        <div className={"sub " + (e("curve") ? "invalid-block" : "")}>
          <div className="sub-head">
            <h3>温度曲线（时间 min / 温度 ℃，升温≤3℃/min）</h3>
            <div>
              <button type="button" onClick={() => {
                const last = draft.curve[draft.curve.length - 1];
                set("curve", [...draft.curve, {
                  uid: nextUid(),
                  t: last && last.t.trim() !== "" ? String(Number(last.t) + 10) : "",
                  temp: last?.temp ?? "",
                }]);
              }}>＋ 添加曲线点</button>
            </div>
          </div>
          <div className="rows">
            {draft.curve.map((c) => (
              <div className="row curve-row" key={c.uid}>
                <input type="number" step="1" value={c.t}
                  onChange={(ev) => updateCurve(c.uid, { t: ev.target.value })} placeholder="时间 min" />
                <input type="number" step="1" value={c.temp}
                  onChange={(ev) => updateCurve(c.uid, { temp: ev.target.value })} placeholder="温度 ℃" />
                <button type="button" className="ghost" disabled={draft.curve.length <= 2}
                  onClick={() => set("curve", draft.curve.filter((x) => x.uid !== c.uid))}>
                  删除
                </button>
              </div>
            ))}
          </div>
          {v.parsed && (
            <div className="live-bar">
              <Sparkline points={v.parsed.curve} />
              <FieldNote
                error={e("curve")}
                warning={w("curve")}
                hint={!e("curve")
                  ? `最大升温 ${round2(v.parsed.stat.maxRamp)}℃/min（上限3）· 最高温 ${round2(v.parsed.stat.maxTemp)}℃ · 最高温平台 ${round2(v.parsed.stat.plateau)}min`
                  : undefined}
              />
            </div>
          )}
          {!v.parsed && <FieldNote error={e("curve")} warning={w("curve")} />}
        </div>

        <div className="field-grid">
          <label className={e("hold") ? "invalid" : ""}>
            <span>保温时间（min）</span>
            <input type="number" step="1" value={draft.holdMin}
              onChange={(ev) => set("holdMin", ev.target.value)} placeholder="如 35" />
            <FieldNote
              error={e("hold")}
              warning={w("hold")}
              hint={!e("hold") && v.parsed
                ? `曲线最高温平台 ${round2(v.parsed.stat.plateau)}min，与保温 ${v.parsed.holdMin}min 一致`
                : undefined}
            />
          </label>
          <label>
            <span>后整理方式</span>
            <input value={draft.finishing} onChange={(ev) => set("finishing", ev.target.value)}
              placeholder="如 柔软剂2% / 定型170℃×45s" />
          </label>
        </div>

        {/* Lab 色差 */}
        <div className="sub">
          <div className="sub-head"><h3>Lab 色差（标准样 vs 化验室小样）</h3></div>
          <div className="lab-grid">
            <div>
              <span>标准样</span>
              <div className="lab-row">
                <input type="number" step="0.1" value={draft.target.l}
                  onChange={(ev) => set("target", { ...draft.target, l: ev.target.value })} placeholder="L" />
                <input type="number" step="0.1" value={draft.target.a}
                  onChange={(ev) => set("target", { ...draft.target, a: ev.target.value })} placeholder="a" />
                <input type="number" step="0.1" value={draft.target.b}
                  onChange={(ev) => set("target", { ...draft.target, b: ev.target.value })} placeholder="b" />
              </div>
            </div>
            <div>
              <span>小样实测</span>
              <div className="lab-row">
                <input type="number" step="0.1" value={draft.sample.l}
                  onChange={(ev) => set("sample", { ...draft.sample, l: ev.target.value })} placeholder="L" />
                <input type="number" step="0.1" value={draft.sample.a}
                  onChange={(ev) => set("sample", { ...draft.sample, a: ev.target.value })} placeholder="a" />
                <input type="number" step="0.1" value={draft.sample.b}
                  onChange={(ev) => set("sample", { ...draft.sample, b: ev.target.value })} placeholder="b" />
              </div>
            </div>
            <div className={"de-box " + (!Number.isNaN(liveDe) && liveDe > PASS_LIMIT ? "de-bad" : "de-ok")}>
              <span>ΔE 实时计算</span>
              <strong>{Number.isNaN(liveDe) ? "—" : liveDe}</strong>
              <small>
                {Number.isNaN(liveDe)
                  ? "填写完整 L/a/b 后计算"
                  : liveDe > PASS_LIMIT
                    ? `ΔE ${liveDe} > 0.8，判级 ${gradeOf(liveDe)}，不能通过评审，可存为待复染`
                    : `ΔE ${liveDe} ≤ 0.8，判级 ${gradeOf(liveDe)}，可通过评审`}
              </small>
            </div>
          </div>
          {(e("target") || e("sample")) && (
            <FieldNote error={e("target") || e("sample")} />
          )}
        </div>

        <label className="full-label">
          <span>备注</span>
          <input value={draft.remark} onChange={(ev) => set("remark", ev.target.value)}
            placeholder="工艺备注 / 客户特殊要求" />
        </label>

        {/* 操作区 */}
        <div className="action-bar">
          <button className="primary" onClick={() => persist("pending")}>
            {editingId ? "保存修改（待评审）" : "保存（待评审）"}
          </button>
          <button className="pass" disabled={Number.isNaN(liveDe) || liveDe > PASS_LIMIT}
            title={liveDe > PASS_LIMIT ? `ΔE ${liveDe} 超过0.8，不能通过评审` : "色差合格，可通过评审"}
            onClick={() => persist("passed")}>
            通过评审
          </button>
          <button className="redye" onClick={() => persist("redye")}>存为待复染</button>
          <button onClick={() => persist("confirming")}>客户确认中</button>
          {editingId && <button className="ghost" onClick={startNew}>取消编辑</button>}
          <div className="action-note">
            {showErrors && Object.keys(v.errors).length > 0
              ? `共 ${Object.keys(v.errors).length} 项联动校验未通过，已在字段旁标注原因，当前不能保存`
              : liveDe > PASS_LIMIT
                ? `ΔE ${liveDe} 超过 0.8：「通过评审」已锁定，可选择「存为待复染」`
                : "所有硬校验通过后即可保存；琥珀色为提示，不阻断保存"}
          </div>
        </div>
      </section>

      {/* ================= 筛选 + 列表 ================= */}
      <section className="panel">
        <div className="heading">
          <div>
            <p>批次列表</p>
            <h2>小样批次（{filtered.length}/{batches.length}）</h2>
          </div>
          <div className="heading-actions">
            <button onClick={startNew}>＋ 新增批次</button>
            <button onClick={exportCsv}>导出CSV</button>
          </div>
        </div>

        <div className="filters">
          <input className="search" value={keyword} onChange={(ev) => setKeyword(ev.target.value)}
            placeholder="按客户、订单号、批次号或面料搜索……" />
          <div className="chips">
            {categories.map((c) => (
              <button key={c} className={chip === c ? "chip-on" : ""} onClick={() => setChip(c)}>{c}</button>
            ))}
          </div>
        </div>

        <div className="table">
          <div className="tr tr-head">
            <span>批次号</span><span>客户 / 订单</span><span>面料 · 成分</span>
            <span>克重 / 浴比</span><span>ΔE · 判级</span><span>评审状态</span><span>操作</span>
          </div>
          {filtered.length === 0 && <div className="empty">没有符合筛选条件的批次</div>}
          {filtered.map((b) => (
            <div className="tr" key={b.id}>
              <span className="mono">{b.id}</span>
              <span>{b.customer}<br /><small className="muted">{b.orderNo}</small></span>
              <span>
                {b.fabricName}
                <br /><small className="muted">{b.fibers.map((f) => `${f.type}${f.percent}%`).join(" / ")}（{b.category}）</small>
              </span>
              <span>{b.weight} g/m²<br /><small className="muted">1:{b.bathRatio}</small></span>
              <span>
                <b className={b.de > PASS_LIMIT ? "num-rose" : "num-green"}>ΔE {b.de}</b>
                <br /><small className="muted">{b.grade}</small>
              </span>
              <span><i className={"badge " + STATUS_META[b.status].cls}>{STATUS_META[b.status].label}</i></span>
              <span><button className="ghost" onClick={() => startEdit(b)}>编辑</button></span>
            </div>
          ))}
        </div>
      </section>

      {/* ================= 联动视图：配方图 / Lab判级 / 工艺摘要 ================= */}
      <section className="view-grid">
        {/* 配方比例图 */}
        <article className="panel">
          <p className="panel-tag">联动视图 1</p>
          <h2>配方比例图</h2>
          {filtered.length === 0 && <div className="empty">无数据</div>}
          <div className="chart-list">
            {filtered.map((b) => (
              <div key={b.id} className="chart-item">
                <div className="chart-title">
                  <b className="mono">{b.id}</b>
                  <small className="muted">{b.fabricName}</small>
                </div>
                <div className="stack">
                  {b.recipe.map((r, i) => (
                    <i key={r.name} className="seg"
                      style={{ width: `${r.percent}%`, background: dyeColor(r.name, i) }}
                      title={`${r.name} ${r.percent}%`} />
                  ))}
                </div>
                <div className="legend">
                  {b.recipe.map((r, i) => (
                    <small key={r.name}>
                      <i className="dot" style={{ background: dyeColor(r.name, i) }} />
                      {r.name} {r.percent}%
                    </small>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>

        {/* Lab 色差判级 */}
        <article className="panel">
          <p className="panel-tag">联动视图 2</p>
          <h2>Lab 色差判级</h2>
          {filtered.length === 0 && <div className="empty">无数据</div>}
          <div className="lab-list">
            {filtered.map((b) => {
              const bad = b.de > PASS_LIMIT;
              return (
                <div key={b.id} className={"lab-card " + (bad ? "lab-bad" : "lab-ok")}>
                  <div className="lab-card-head">
                    <b className="mono">{b.id}</b>
                    <i className={"badge " + STATUS_META[b.status].cls}>{STATUS_META[b.status].label}</i>
                  </div>
                  <div className="lab-compare">
                    <span><small className="muted">标准</small>L {b.targetLab.l} / a {b.targetLab.a} / b {b.targetLab.b}</span>
                    <span><small className="muted">小样</small>L {b.sampleLab.l} / a {b.sampleLab.a} / b {b.sampleLab.b}</span>
                  </div>
                  <div className="lab-verdict">
                    <strong>ΔE {b.de}</strong>
                    <span className="grade">{b.grade}</span>
                    <small className={bad ? "verdict-bad" : "verdict-ok"}>
                      {bad ? "超过0.8，不能通过评审 · 可存为待复染" : "ΔE≤0.8，满足通过评审条件"}
                    </small>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      {/* 工艺摘要 */}
      <section className="panel">
        <p className="panel-tag">联动视图 3</p>
        <h2>工艺摘要</h2>
        {filtered.length === 0 && <div className="empty">无数据</div>}
        <div className="proc-list">
          {filtered.map((b) => {
            const stat = analyzeCurve(b.curve);
            return (
              <article key={b.id} className="proc-card">
                <div className="proc-main">
                  <h3 className="mono">{b.id} <small className="muted">{b.customer} · {b.orderNo}</small></h3>
                  <p>
                    {b.fabricName}（{b.fibers.map((f) => `${f.type}${f.percent}%`).join("/")}）·
                    克重 {b.weight}g/m² · 浴比 1:{b.bathRatio} · 保温 {b.holdMin}min
                    {b.finishing ? ` · 后整理 ${b.finishing}` : ""}
                  </p>
                  <p className="muted">
                    最高温 {stat ? round2(stat.maxTemp) : "—"}℃ ·
                    最高温平台 {stat ? round2(stat.plateau) : "—"}min ·
                    最大升温 {stat ? round2(stat.maxRamp) : "—"}℃/min ·
                    ΔE {b.de}（{b.grade}）
                  </p>
                </div>
                <Sparkline points={b.curve} />
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
