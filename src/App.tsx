import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type { Batch } from "./types";
import { COMPOSITIONS } from "./catalog";
import { loadBatches, saveBatches } from "./data";
import { DELTA_E_LIMIT, deltaE, analyzeCurve } from "./validation";
import BatchForm from "./components/BatchForm";
import SummaryPanel from "./components/SummaryPanel";

const STATUS_STYLE: Record<string, string> = {
  评审通过: "st-pass",
  待复染: "st-redo",
  客户确认中: "st-wait",
};

function App() {
  const [batches, setBatches] = useState<Batch[]>(() => loadBatches());
  const [orderFilter, setOrderFilter] = useState("全部");
  const [compositionFilter, setCompositionFilter] = useState("全部");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Batch | null | "new">(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    saveBatches(batches);
  }, [batches]);

  const orders = useMemo(
    () => [...new Set(batches.map((b) => b.orderNo))].sort(),
    [batches]
  );

  const filtered = useMemo(
    () =>
      batches.filter(
        (b) =>
          (orderFilter === "全部" || b.orderNo === orderFilter) &&
          (compositionFilter === "全部" || b.composition === compositionFilter)
      ),
    [batches, orderFilter, compositionFilter]
  );

  // 筛选变化后，选中项不在集合内则自动落到第一条，保证摘要始终与列表联动
  const selected = useMemo(() => {
    const hit = filtered.find((b) => b.id === selectedId) ?? null;
    return hit ?? filtered[0] ?? null;
  }, [filtered, selectedId]);

  const overCount = batches.filter((b) => deltaE(b.dl, b.da, b.db) > DELTA_E_LIMIT).length;
  const passRate = batches.length
    ? Math.round((batches.filter((b) => b.status === "评审通过").length / batches.length) * 100)
    : 0;

  const nextId = useMemo(() => {
    const nums = batches
      .map((b) => /^LAB-(\d{3})/.exec(b.id)?.[1])
      .filter(Boolean)
      .map((s) => Number(s)) as number[];
    const n = (nums.length ? Math.max(...nums) : 620) + 1;
    return `LAB-${n}A`;
  }, [batches]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2600);
  };

  const handleSave = (b: Batch) => {
    setBatches((prev) => {
      const idx = prev.findIndex((x) => x.id === b.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = b;
        return next;
      }
      return [...prev, b];
    });
    setSelectedId(b.id);
    setEditing(null);
    showToast(`批次 ${b.id} 已保存`);
  };

  const setStatus = (b: Batch, status: Batch["status"]) => {
    if (status === "评审通过" && deltaE(b.dl, b.da, b.db) > DELTA_E_LIMIT) {
      showToast(`${b.id} 的 ΔE=${deltaE(b.dl, b.da, b.db).toFixed(2)} 超过 ${DELTA_E_LIMIT}，不能通过评审，已保留原状态`);
      return;
    }
    setBatches((prev) => prev.map((x) => (x.id === b.id ? { ...x, status } : x)));
    showToast(`${b.id} 评审结果已更新为「${status}」`);
  };

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62012 · 纺织染整实验室 · 小样工作台</p>
        <h1>小样批次管理</h1>
        <span>
          面料成分、克重、配方比例、浴比、保温时间与温度曲线联动校验；筛选后配方比例图、Lab 色差判级与工艺摘要同步更新。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>小样批次</small>
          <strong>{batches.length}</strong>
        </article>
        <article>
          <small>色差超限（ΔE&gt;{DELTA_E_LIMIT}）</small>
          <strong className={overCount ? "num-bad" : ""}>{overCount}</strong>
        </article>
        <article>
          <small>客户订单</small>
          <strong>{orders.length}</strong>
        </article>
        <article>
          <small>通过率</small>
          <strong>{passRate}%</strong>
        </article>
      </section>

      <section className="panel filter-bar">
        <div className="filter-group">
          <span>客户订单</span>
          <select value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)}>
            <option>全部</option>
            {orders.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
        <div className="filter-group comps">
          <span>面料成分</span>
          <div className="chips">
            {["全部", ...COMPOSITIONS].map((c) => (
              <button
                key={c}
                className={compositionFilter === c ? "chip-on" : ""}
                onClick={() => setCompositionFilter(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <button className="primary" onClick={() => setEditing("new")}>
          + 新增批次
        </button>
      </section>

      <SummaryPanel batches={filtered} selected={selected} />

      <section className="panel">
        <div className="heading">
          <div>
            <p>可操作批次列表</p>
            <h2>
              小样批次
              <span className="count-tag">
                筛选 {filtered.length} / 共 {batches.length}
              </span>
            </h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="batch-table">
            <thead>
              <tr>
                <th>批次号</th>
                <th>客户订单 / 客户</th>
                <th>成分 · 克重</th>
                <th>配方合计</th>
                <th>浴比</th>
                <th>保温/平台</th>
                <th>ΔE / 判级</th>
                <th>评审结果</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const de = deltaE(b.dl, b.da, b.db);
                const total = b.recipe.reduce((s, r) => s + r.ratio, 0);
                const info = analyzeLite(b);
                const active = selected?.id === b.id;
                return (
                  <tr
                    key={b.id}
                    className={active ? "row-active" : ""}
                    onClick={() => setSelectedId(b.id)}
                  >
                    <td>
                      <b>{b.id}</b>
                      <small className="muted"> {b.fabricName}</small>
                    </td>
                    <td>
                      {b.orderNo}
                      <small className="muted"> {b.customer}</small>
                    </td>
                    <td>
                      {b.composition} · {b.weight}g/m²
                    </td>
                    <td className={Math.abs(total - 100) > 0.01 ? "bad" : ""}>
                      {total.toFixed(1)}%
                    </td>
                    <td>1:{b.liquorRatio}</td>
                    <td className={info.holdBad ? "bad" : ""}>
                      {b.holdMinutes}/{info.topHold}min
                      {info.rampBad && <small className="warn-text"> 升温{info.ramp.toFixed(1)}</small>}
                    </td>
                    <td className={de > DELTA_E_LIMIT ? "bad" : ""}>
                      {de.toFixed(2)}
                      <small className="muted"> ΔE</small>
                    </td>
                    <td>
                      <span className={"status-tag " + STATUS_STYLE[b.status]}>{b.status}</span>
                    </td>
                    <td className="ops" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setEditing(b)}>编辑</button>
                      <button
                        disabled={de > DELTA_E_LIMIT || b.status === "评审通过"}
                        title={
                          de > DELTA_E_LIMIT ? `ΔE 超过 ${DELTA_E_LIMIT}，不能通过评审` : "通过评审"
                        }
                        onClick={() => setStatus(b, "评审通过")}
                      >
                        通过
                      </button>
                      <button
                        disabled={b.status === "待复染"}
                        onClick={() => setStatus(b, "待复染")}
                      >
                        待复染
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty-row">
                    当前客户订单 / 成分筛选下没有批次，请调整筛选或新增批次
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editing !== null && (
        <BatchForm
          editing={editing === "new" ? null : editing}
          existingIds={batches.map((b) => b.id)}
          nextId={nextId}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function analyzeLite(b: Batch) {
  const info = analyzeCurve(b.curve);
  return {
    ramp: info.maxRamp,
    topHold: info.topHold,
    rampBad: info.maxRamp > 3,
    holdBad: b.holdMinutes > 0 && (info.topHold <= 0 || info.topHold + 1 < b.holdMinutes),
  };
}

export default App;
