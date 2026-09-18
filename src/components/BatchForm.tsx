import { useMemo, useState } from "react";
import type { Batch, Composition, CurvePoint, ReviewStatus } from "../types";
import { COMPOSITIONS, DYE_CATALOG } from "../catalog";
import {
  analyzeCurve,
  deltaE,
  deltaEGrade,
  DELTA_E_LIMIT,
  MAX_RAMP,
  validateBatch,
  type ErrorMap,
} from "../validation";

interface Draft {
  id: string;
  orderNo: string;
  customer: string;
  fabricName: string;
  composition: Composition;
  weight: string;
  recipe: { dye: string; ratio: string }[];
  liquorRatio: string;
  holdMinutes: string;
  curve: { minute: string; temp: string }[];
  finish: string;
  dl: string;
  da: string;
  db: string;
  status: ReviewStatus;
  note: string;
}

const num = (s: string): number => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : NaN;
};

function toDraft(b: Batch | null): Draft {
  return {
    id: b?.id ?? "",
    orderNo: b?.orderNo ?? "",
    customer: b?.customer ?? "",
    fabricName: b?.fabricName ?? "",
    composition: b?.composition ?? "棉",
    weight: b ? String(b.weight) : "",
    recipe: b
      ? b.recipe.map((r) => ({ dye: r.dye, ratio: String(r.ratio) }))
      : [
          { dye: "", ratio: "" },
          { dye: "", ratio: "" },
        ],
    liquorRatio: b ? String(b.liquorRatio) : "",
    holdMinutes: b ? String(b.holdMinutes) : "",
    curve: b
      ? b.curve.map((p) => ({ minute: String(p.minute), temp: String(p.temp) }))
      : [
          { minute: "0", temp: "30" },
          { minute: "", temp: "" },
        ],
    finish: b?.finish ?? "",
    dl: b ? String(b.dl) : "",
    da: b ? String(b.da) : "",
    db: b ? String(b.db) : "",
    status: b?.status ?? "待复染",
    note: b?.note ?? "",
  };
}

function toBatch(d: Draft): Batch {
  return {
    id: d.id.trim(),
    orderNo: d.orderNo.trim(),
    customer: d.customer.trim(),
    fabricName: d.fabricName.trim(),
    composition: d.composition,
    weight: num(d.weight),
    recipe: d.recipe
      .filter((r) => r.dye.trim() !== "")
      .map((r) => ({ dye: r.dye, ratio: num(r.ratio) || 0 })),
    liquorRatio: num(d.liquorRatio),
    holdMinutes: num(d.holdMinutes),
    curve: d.curve
      .filter((p) => p.minute.trim() !== "" && p.temp.trim() !== "")
      .map((p) => ({ minute: num(p.minute), temp: num(p.temp) })) as CurvePoint[],
    finish: d.finish.trim(),
    dl: num(d.dl),
    da: num(d.da),
    db: num(d.db),
    status: d.status,
    note: d.note.trim(),
  };
}

export default function BatchForm({
  editing,
  existingIds,
  nextId,
  onClose,
  onSave,
}: {
  editing: Batch | null;
  existingIds: string[];
  nextId: string;
  onClose: () => void;
  onSave: (b: Batch) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(editing));
  const [touched, setTouched] = useState(false);

  const idsForCheck = editing ? existingIds.filter((x) => x !== editing.id) : existingIds;
  const batch = useMemo(() => toBatch(draft), [draft]);
  const errors: ErrorMap = useMemo(() => validateBatch(batch, idsForCheck), [batch, idsForCheck]);
  const blocked = Object.keys(errors).length > 0;

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const recipeTotal = batch.recipe.reduce((s, r) => s + r.ratio, 0);
  const curveInfo = useMemo(
    () =>
      analyzeCurve(
        batch.curve.filter((p) => Number.isFinite(p.minute) && Number.isFinite(p.temp))
      ),
    [batch.curve]
  );
  const de = deltaE(batch.dl || 0, batch.da || 0, batch.db || 0);

  const submit = () => {
    setTouched(true);
    if (!blocked) onSave(batch);
  };

  const show = (key: keyof ErrorMap) =>
    touched && errors[key] ? <small className="field-error">{errors[key]}</small> : null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="heading modal-head">
          <div>
            <p>{editing ? "编辑批次" : "新增批次"}</p>
            <h2>{editing ? editing.id : nextId}</h2>
          </div>
          <button className="ghost" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {blocked && touched && (
          <div className="save-banner">
            存在 {Object.keys(errors).length} 项联动校验问题，已阻止保存，请按字段旁提示修正
          </div>
        )}

        <div className="form-scroll">
          <h3 className="form-sec">基础信息</h3>
          <div className="field-grid">
            <label>
              <span>小样批次号 *</span>
              <input
                value={draft.id}
                placeholder={nextId}
                onChange={(e) => patch("id", e.target.value)}
              />
              {show("id")}
            </label>
            <label>
              <span>客户订单号 *</span>
              <input value={draft.orderNo} onChange={(e) => patch("orderNo", e.target.value)} />
              {show("orderNo")}
            </label>
            <label>
              <span>客户</span>
              <input value={draft.customer} onChange={(e) => patch("customer", e.target.value)} />
            </label>
            <label>
              <span>织物名称</span>
              <input
                value={draft.fabricName}
                placeholder="如 棉府绸 / 涤纶针织"
                onChange={(e) => patch("fabricName", e.target.value)}
              />
            </label>
            <label>
              <span>面料成分 *（联动染料与染色温度）</span>
              <select
                value={draft.composition}
                onChange={(e) => patch("composition", e.target.value as Composition)}
              >
                {COMPOSITIONS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              <span>克重 g/m² *（联动浴比区间）</span>
              <input
                type="number"
                value={draft.weight}
                onChange={(e) => patch("weight", e.target.value)}
              />
              {show("weight")}
            </label>
          </div>

          <h3 className="form-sec">
            染料配方
            <em className={Math.abs(recipeTotal - 100) <= 0.01 ? "ok-text" : "warn-text"}>
              合计 {recipeTotal.toFixed(2)}%（须为 100%，当前差 {(100 - recipeTotal).toFixed(2)}）
            </em>
          </h3>
          <div className="recipe-rows">
            {draft.recipe.map((row, i) => (
              <div className="recipe-row" key={i}>
                <select
                  value={row.dye}
                  onChange={(e) => {
                    const next = [...draft.recipe];
                    next[i] = { ...row, dye: e.target.value };
                    patch("recipe", next);
                  }}
                >
                  <option value="">选择染料</option>
                  {(["活性", "分散", "酸性", "直接"] as const).map((cls) => (
                    <optgroup key={cls} label={`${cls}染料`}>
                      {DYE_CATALOG.filter((d) => d.cls === cls).map((d) => (
                        <option key={d.name}>{d.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <input
                  type="number"
                  placeholder="占比 %"
                  value={row.ratio}
                  onChange={(e) => {
                    const next = [...draft.recipe];
                    next[i] = { ...row, ratio: e.target.value };
                    patch("recipe", next);
                  }}
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => patch("recipe", draft.recipe.filter((_, j) => j !== i))}
                >
                  删除
                </button>
              </div>
            ))}
            <button
              type="button"
              className="ghost add-btn"
              onClick={() => patch("recipe", [...draft.recipe, { dye: "", ratio: "" }])}
            >
              + 添加染料
            </button>
          </div>
          {show("recipe")}

          <h3 className="form-sec">工艺参数</h3>
          <div className="field-grid">
            <label>
              <span>浴比 1 : *</span>
              <input
                type="number"
                value={draft.liquorRatio}
                onChange={(e) => patch("liquorRatio", e.target.value)}
              />
              {show("liquorRatio")}
            </label>
            <label>
              <span>保温时间 min *（与曲线平台联动）</span>
              <input
                type="number"
                value={draft.holdMinutes}
                onChange={(e) => patch("holdMinutes", e.target.value)}
              />
              {show("holdMinutes")}
            </label>
          </div>

          <h3 className="form-sec">
            温度曲线（时间 min / 温度 ℃）
            <em className={curveInfo.maxRamp > MAX_RAMP ? "warn-text" : "ok-text"}>
              最大升温 {curveInfo.maxRamp.toFixed(2)}℃/min（上限 {MAX_RAMP}） · 最高温{" "}
              {curveInfo.maxTemp}℃ · 最高温平台 {curveInfo.topHold}min
            </em>
          </h3>
          <div className="curve-rows">
            {draft.curve.map((p, i) => (
              <div className="curve-row" key={i}>
                <input
                  type="number"
                  placeholder="时间"
                  value={p.minute}
                  onChange={(e) => {
                    const next = [...draft.curve];
                    next[i] = { ...p, minute: e.target.value };
                    patch("curve", next);
                  }}
                />
                <input
                  type="number"
                  placeholder="温度"
                  value={p.temp}
                  onChange={(e) => {
                    const next = [...draft.curve];
                    next[i] = { ...p, temp: e.target.value };
                    patch("curve", next);
                  }}
                />
                <button
                  type="button"
                  className="ghost"
                  onClick={() => patch("curve", draft.curve.filter((_, j) => j !== i))}
                >
                  删除
                </button>
              </div>
            ))}
            <button
              type="button"
              className="ghost add-btn"
              onClick={() => patch("curve", [...draft.curve, { minute: "", temp: "" }])}
            >
              + 添加控制点
            </button>
          </div>
          {show("curve")}

          <h3 className="form-sec">对色与评审</h3>
          <div className="field-grid">
            <label>
              <span>ΔL 明暗</span>
              <input
                type="number"
                step="0.01"
                value={draft.dl}
                onChange={(e) => patch("dl", e.target.value)}
              />
              {show("dl")}
            </label>
            <label>
              <span>Δa 红绿</span>
              <input
                type="number"
                step="0.01"
                value={draft.da}
                onChange={(e) => patch("da", e.target.value)}
              />
              {show("da")}
            </label>
            <label>
              <span>Δb 黄蓝</span>
              <input
                type="number"
                step="0.01"
                value={draft.db}
                onChange={(e) => patch("db", e.target.value)}
              />
              {show("db")}
            </label>
            <label>
              <span>评审结果</span>
              <select
                value={draft.status}
                onChange={(e) => patch("status", e.target.value as ReviewStatus)}
              >
                <option>评审通过</option>
                <option>待复染</option>
                <option>客户确认中</option>
              </select>
              {show("status")}
            </label>
            <label className="full">
              <span>后整理方式</span>
              <input value={draft.finish} onChange={(e) => patch("finish", e.target.value)} />
            </label>
            <label className="full">
              <span>备注</span>
              <input value={draft.note} onChange={(e) => patch("note", e.target.value)} />
            </label>
          </div>
          <p className={"de-preview " + (de > DELTA_E_LIMIT ? "warn-text" : "ok-text")}>
            当前 ΔE = {de.toFixed(2)}（{deltaEGrade(de).label}）
            {de > DELTA_E_LIMIT && "，评审结果不能选「评审通过」，可存为待复染"}
          </p>
        </div>

        <div className="modal-foot">
          <button className="ghost" onClick={onClose}>
            取消
          </button>
          <button className="primary" onClick={submit}>
            {blocked ? "校验未通过 · 不能保存" : "保存批次"}
          </button>
        </div>
      </div>
    </div>
  );
}
