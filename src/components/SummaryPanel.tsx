import type { Batch } from "../types";
import { DELTA_E_LIMIT, deltaE, deltaEGrade, analyzeCurve } from "../validation";
import { RecipeDonut, CurveSparkline } from "./Charts";

/** 列表筛选后联动更新的三块摘要：配方比例图 / Lab 色差判级 / 工艺摘要 */
export default function SummaryPanel({ batches, selected }: { batches: Batch[]; selected: Batch | null }) {
  const b = selected ?? batches[0] ?? null;

  const passCount = batches.filter((x) => x.status === "评审通过").length;
  const overCount = batches.filter(
    (x) => deltaE(x.dl, x.da, x.db) > DELTA_E_LIMIT
  ).length;

  return (
    <div className="summary-grid">
      <section className="panel summary-card">
        <div className="heading">
          <div>
            <p>筛选联动</p>
            <h2>配方比例图</h2>
          </div>
          <span className="pill">{batches.length} 批</span>
        </div>
        {batches.length > 0 ? (
          <RecipeDonut batches={batches} />
        ) : (
          <p className="muted">当前筛选无批次</p>
        )}
        <p className="card-foot">占比为筛选集合内各批次归一化后的均值</p>
      </section>

      <section className="panel summary-card">
        <div className="heading">
          <div>
            <p>对色结果</p>
            <h2>Lab 色差判级</h2>
          </div>
          {b && <span className="pill">{b.id}</span>}
        </div>
        {b ? <LabGrade batch={b} /> : <p className="muted">请选择批次</p>}
        <div className="mini-stats">
          <span>
            集合超限 <b className={overCount > 0 ? "bad" : "good"}>{overCount}</b> 批
          </span>
          <span>
            已通过 <b className="good">{passCount}</b> / {batches.length}
          </span>
        </div>
      </section>

      <section className="panel summary-card wide">
        <div className="heading">
          <div>
            <p>温度曲线 · 工艺</p>
            <h2>工艺摘要</h2>
          </div>
          {b && (
            <span className="pill">
              {b.composition} · {b.weight}g/m²
            </span>
          )}
        </div>
        {b ? <ProcessSummary batch={b} /> : <p className="muted">请选择批次</p>}
      </section>
    </div>
  );
}

function LabGrade({ batch }: { batch: Batch }) {
  const de = deltaE(batch.dl, batch.da, batch.db);
  const grade = deltaEGrade(de);
  const over = de > DELTA_E_LIMIT;
  const scale = [
    { g: 5, w: 15 },
    { g: 4.5, w: 10 },
    { g: 4, w: 15 },
    { g: 3.5, w: 20 },
    { g: 3, w: 20 },
    { g: 2, w: 20 },
  ];

  return (
    <div>
      <div className={"de-big " + (over ? "bad" : "good")}>
        <strong>ΔE {de.toFixed(2)}</strong>
        <span>{grade.label}</span>
      </div>
      <div className="grade-bar">
        {scale.map((s) => {
          const active = grade.grade >= s.g;
          return (
            <i
              key={s.g}
              className={active ? (over ? "seg-bad" : "seg-good") : ""}
              style={{ flex: s.w }}
              title={`${s.g}级`}
            />
          );
        })}
      </div>
      <table className="lab-table">
        <thead>
          <tr>
            <th />
            <th>ΔL 明暗</th>
            <th>Δa 红绿</th>
            <th>Δb 黄蓝</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>实测</td>
            <td>{batch.dl.toFixed(2)}</td>
            <td>{batch.da.toFixed(2)}</td>
            <td>{batch.db.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      <p className={over ? "alert-text" : "ok-text"}>
        {over
          ? `ΔE 超过 ${DELTA_E_LIMIT}，不能通过评审，请存为「待复染」`
          : `ΔE ≤ ${DELTA_E_LIMIT}，满足评审放行条件`}
      </p>
    </div>
  );
}

function ProcessSummary({ batch }: { batch: Batch }) {
  const info = analyzeCurve(batch.curve);
  const rampBad = info.maxRamp > 3;
  const holdBad = info.topHold + 1 < batch.holdMinutes;

  return (
    <div className="process-grid">
      <CurveSparkline curve={batch.curve} composition={batch.composition} />
      <div className="process-facts">
        <dl>
          <div>
            <dt>面料</dt>
            <dd>
              {batch.fabricName} · {batch.composition} · {batch.weight}g/m²
            </dd>
          </div>
          <div>
            <dt>浴比</dt>
            <dd>
              1:{batch.liquorRatio}
            </dd>
          </div>
          <div>
            <dt>升温</dt>
            <dd className={rampBad ? "bad" : ""}>
              最大 {info.maxRamp.toFixed(2)}℃/min（上限 3）{rampBad ? " ⚠ 超限" : " ✓"}
            </dd>
          </div>
          <div>
            <dt>保温</dt>
            <dd className={holdBad ? "bad" : ""}>
              设定 {batch.holdMinutes}min / 曲线平台 {info.topHold}min
              {holdBad ? " ⚠ 不符" : " ✓"}
            </dd>
          </div>
          <div>
            <dt>配方</dt>
            <dd>
              {batch.recipe.map((r) => `${r.dye} ${r.ratio}%`).join("，")}
            </dd>
          </div>
          <div>
            <dt>后整理</dt>
            <dd>{batch.finish || "—"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
