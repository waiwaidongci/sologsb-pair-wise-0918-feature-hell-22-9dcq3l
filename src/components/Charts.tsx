import type { Batch, CurvePoint } from "../types";
import { analyzeCurve } from "../validation";

const COLORS = ["#be123c", "#4f46e5", "#16a34a", "#d97706", "#0891b2", "#7c3aed"];

/** 按染料名称聚合筛选后批次的配方占比（先在每个批次内归一化，再平均） */
export function aggregateRecipe(batches: Batch[]): { name: string; pct: number; color: string }[] {
  const map = new Map<string, number>();
  batches.forEach((b) => {
    const total = b.recipe.reduce((s, r) => s + r.ratio, 0) || 1;
    b.recipe.forEach((r) => {
      map.set(r.dye, (map.get(r.dye) ?? 0) + (r.ratio / total) * 100);
    });
  });
  const n = batches.length || 1;
  return [...map.entries()]
    .map(([name, sum], i) => ({ name, pct: sum / n, color: COLORS[i % COLORS.length] }))
    .sort((a, b) => b.pct - a.pct);
}

export function RecipeDonut({ batches }: { batches: Batch[] }) {
  const data = aggregateRecipe(batches);
  const size = 168;
  const r = 64;
  const cx = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="配方比例图">
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          {data.map((d) => {
            const len = (d.pct / 100) * circ;
            const el = (
              <circle
                key={d.name}
                cx={cx}
                cy={cx}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={22}
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </g>
        <text x={cx} y={cx - 4} textAnchor="middle" className="donut-num">
          {batches.length}
        </text>
        <text x={cx} y={cx + 16} textAnchor="middle" className="donut-label">
          个批次
        </text>
      </svg>
      <ul className="legend">
        {data.map((d) => (
          <li key={d.name}>
            <i style={{ background: d.color }} />
            <span>{d.name}</span>
            <b>{d.pct.toFixed(1)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 温度曲线缩略图 */
export function CurveSparkline({ curve, composition }: { curve: CurvePoint[]; composition: string }) {
  const sorted = [...curve].sort((a, b) => a.minute - b.minute);
  if (sorted.length < 2) return <p className="muted">曲线点不足</p>;
  const w = 300;
  const h = 110;
  const padX = 30;
  const padY = 16;
  const maxT = Math.ceil(Math.max(...sorted.map((p) => p.temp)) / 10) * 10;
  const maxM = sorted[sorted.length - 1].minute || 1;
  const x = (m: number) => padX + (m / maxM) * (w - padX * 2);
  const y = (t: number) => h - padY - (t / maxT) * (h - padY * 2);
  const path = sorted.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.minute)},${y(p.temp)}`).join(" ");
  const info = analyzeCurve(curve);

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="curve-svg" role="img" aria-label="温度曲线">
        {[0, 0.5, 1].map((g) => (
          <line
            key={g}
            x1={padX}
            x2={w - padX}
            y1={padY + g * (h - padY * 2)}
            y2={padY + g * (h - padY * 2)}
            stroke="#e2e8f0"
          />
        ))}
        <path d={path} fill="none" stroke="#be123c" strokeWidth={2.4} />
        {sorted.map((p) => (
          <circle key={p.minute} cx={x(p.minute)} cy={y(p.temp)} r={3} fill="#4f46e5" />
        ))}
        <text x={padX} y={12} className="axis">
          {maxT}℃
        </text>
        <text x={padX} y={h - 2} className="axis">
          0
        </text>
        <text x={w - padX} y={h - 2} textAnchor="end" className="axis">
          {maxM}min
        </text>
      </svg>
      <p className="curve-facts">
        {composition} · 最高 {info.maxTemp}℃ · 最大升温 {info.maxRamp.toFixed(2)}℃/min · 保温平台{" "}
        {info.topHold}min
      </p>
    </div>
  );
}
