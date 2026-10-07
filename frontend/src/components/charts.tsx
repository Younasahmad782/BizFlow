import { formatPKR } from '../lib/format'

interface Point {
  label: string
  value: number
}

/** Simple responsive bar chart rendered as SVG — no chart library needed. */
export function BarChart({ data, height = 180 }: { data: Point[]; height?: number }) {
  if (data.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No data for this period.</p>
  }
  const max = Math.max(...data.map((d) => d.value), 1)
  const W = 600
  const H = height
  const padBottom = 28
  const barW = Math.min(48, (W / data.length) * 0.55)
  const step = W / data.length

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {data.map((d, i) => {
        const h = Math.max(3, ((H - padBottom - 8) * d.value) / max)
        const x = step * i + (step - barW) / 2
        const y = H - padBottom - h
        return (
          <g key={i}>
            <title>{`${d.label}: ${formatPKR(d.value)}`}</title>
            <rect x={x} y={y} width={barW} height={h} rx={3} className="fill-brand-500" opacity={0.85} />
            {(data.length <= 12 || i % Math.ceil(data.length / 12) === 0) && (
              <text
                x={step * i + step / 2}
                y={H - 10}
                textAnchor="middle"
                className="fill-slate-500"
                fontSize={11}
              >
                {d.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** Horizontal bars for ranked lists (top products, categories). */
export function RankedBars({ data, maxItems = 6 }: { data: Point[]; maxItems?: number }) {
  const rows = data.slice(0, maxItems)
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No data for this period.</p>
  }
  const max = Math.max(...rows.map((d) => d.value), 1)
  return (
    <div className="space-y-2.5">
      {rows.map((d, i) => (
        <div key={i}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-700 truncate pr-2">{d.label}</span>
            <span className="font-medium tabular-nums whitespace-nowrap">{formatPKR(d.value)}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-500 rounded-full"
              style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Donut chart for payment methods / category splits. */
export function DonutChart({ data }: { data: { name: string; value: number }[] }) {
  const rows = data.filter((d) => d.value > 0)
  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 py-8 text-center">No data for this period.</p>
  }
  const total = rows.reduce((s, d) => s + d.value, 0)
  const colors = ['#0e7490', '#0284c7', '#65a30d', '#d97706', '#dc2626', '#7c3aed', '#64748b']
  const R = 54
  const C = 2 * Math.PI * R
  let offset = 0

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 140 140" className="w-36 h-36 shrink-0" role="img">
        {rows.map((d, i) => {
          const frac = d.value / total
          const el = (
            <circle
              key={i}
              cx={70}
              cy={70}
              r={R}
              fill="none"
              stroke={colors[i % colors.length]}
              strokeWidth={22}
              strokeDasharray={`${frac * C} ${C}`}
              strokeDashoffset={-offset * C}
              transform="rotate(-90 70 70)"
            >
              <title>{`${d.name}: ${formatPKR(d.value)}`}</title>
            </circle>
          )
          offset += frac
          return el
        })}
        <text x={70} y={66} textAnchor="middle" fontSize={15} fontWeight={700} className="fill-slate-900">
          {formatPKR(total).replace('Rs. ', 'Rs.')}
        </text>
        <text x={70} y={84} textAnchor="middle" fontSize={10} className="fill-slate-500">
          total
        </text>
      </svg>
      <ul className="space-y-1.5 text-sm flex-1">
        {rows.map((d, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-slate-600 truncate">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: colors[i % colors.length] }}
              />
              <span className="truncate">{d.name.replace('_', ' ')}</span>
            </span>
            <span className="tabular-nums font-medium whitespace-nowrap">{formatPKR(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
