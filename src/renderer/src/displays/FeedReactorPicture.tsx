import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { moduleAlarm } from '../utils/format'
import type { AnyModule } from '../engine/types'

/** The 8001 reference picture is 817 x 507; every coordinate below is in those picture pixels. */
export const PICTURE_W = 817
export const PICTURE_H = 507
export const FEED_REACTOR_PICTURE = './feed-reactor-picture.png'

type Row = 'PV' | 'SP' | 'OUT' | 'ST'
/** A tag box baked into the picture whose numbers are replaced by live values. */
interface Readout { tag: string; x: number; w: number; y: number; rows: Row[] }
/** A clickable piece of equipment; clicking opens the module's faceplate. */
interface Hotspot { tag: string; x: number; y: number; w: number; h: number; label: string }

export const READOUTS: Readout[] = [
  { tag: 'FIC-101', x: 39, w: 67, y: 104, rows: ['PV', 'SP', 'OUT'] },
  { tag: 'TI-101', x: 131, w: 68, y: 104, rows: ['PV'] },
  { tag: 'SIC-201', x: 223, w: 81, y: 74, rows: ['PV', 'SP', 'OUT'] },
  { tag: 'II-201', x: 237, w: 67, y: 111, rows: ['PV'] },
  { tag: 'LSH-101', x: 261, w: 68, y: 252, rows: ['ST'] },
  { tag: 'LIC-101', x: 261, w: 68, y: 291, rows: ['PV', 'SP', 'OUT'] },
  { tag: 'LIC-201', x: 449, w: 68, y: 331, rows: ['PV', 'SP', 'OUT'] },
  { tag: 'TIC-201', x: 449, w: 68, y: 373, rows: ['PV', 'SP', 'OUT'] },
  { tag: 'PT-201', x: 449, w: 68, y: 415, rows: ['PV'] },
  { tag: 'AT-301', x: 664, w: 67, y: 279, rows: ['PV'] },
  { tag: 'PIC-301', x: 688, w: 68, y: 409, rows: ['PV', 'SP', 'OUT'] }
]

export const HOTSPOTS: Hotspot[] = [
  { tag: 'FIC-101', x: 38, y: 89, w: 69, h: 36, label: 'FIC-101 flow controller' },
  { tag: 'FIC-101', x: 93, y: 175, w: 22, h: 26, label: 'FIC-101 flow valve' },
  { tag: 'TI-101', x: 130, y: 89, w: 70, h: 20, label: 'TI-101 temperature' },
  { tag: 'XV-101', x: 135, y: 174, w: 34, h: 28, label: 'XV-101 feed block valve' },
  { tag: 'LIC-101', x: 163, y: 224, w: 77, h: 124, label: 'TK-101 feed tank level' },
  { tag: 'LSH-101', x: 260, y: 237, w: 70, h: 21, label: 'LSH-101 high level switch' },
  { tag: 'LIC-101', x: 260, y: 276, w: 70, h: 35, label: 'LIC-101 level controller' },
  { tag: 'P-101', x: 259, y: 382, w: 28, h: 28, label: 'P-101 feed pump' },
  { tag: 'SIC-201', x: 222, y: 59, w: 83, h: 37, label: 'SIC-201 agitator speed' },
  { tag: 'II-201', x: 236, y: 97, w: 69, h: 21, label: 'II-201 agitator current' },
  { tag: 'XV-201', x: 333, y: 152, w: 36, h: 28, label: 'XV-201 product block valve' },
  { tag: 'PSV-201', x: 379, y: 256, w: 36, h: 30, label: 'PSV-201 relief valve' },
  { tag: 'SIC-201', x: 408, y: 298, w: 24, h: 22, label: 'Agitator drive' },
  { tag: 'LIC-201', x: 355, y: 324, w: 90, h: 118, label: 'TK-201 reactor level' },
  { tag: 'LIC-201', x: 448, y: 315, w: 70, h: 37, label: 'LIC-201 level controller' },
  { tag: 'TIC-201', x: 448, y: 357, w: 70, h: 37, label: 'TIC-201 temperature controller' },
  { tag: 'PT-201', x: 448, y: 399, w: 70, h: 21, label: 'PT-201 pressure' },
  { tag: 'P-201', x: 476, y: 457, w: 30, h: 30, label: 'P-201 product pump' },
  { tag: 'AT-301', x: 663, y: 264, w: 69, h: 21, label: 'AT-301 analyzer' },
  { tag: 'PIC-301', x: 601, y: 224, w: 48, h: 114, label: 'HDR-301 product header' },
  { tag: 'PIC-301', x: 632, y: 383, w: 28, h: 28, label: 'PIC-301 pressure valve' },
  { tag: 'PIC-301', x: 687, y: 394, w: 70, h: 37, label: 'PIC-301 pressure controller' }
]

const PATCH = '#fcfdfd'

function value(m: AnyModule | undefined, row: Row): string {
  if (!m) return '—'
  if (row === 'ST') return m.type === 'DI' ? (m.state === (m.alarmOnValue ?? true) ? 'HIGH' : 'NORMAL') : '—'
  if (m.type === 'PID') {
    const n = row === 'PV' ? m.pv : row === 'SP' ? m.sp : m.out
    const unit = row === 'OUT' ? '%' : m.unit
    return Number.isFinite(n) ? `${n.toFixed(row === 'OUT' ? 1 : m.decimals ?? 1)}${unit}` : '—'
  }
  if (m.type === 'AI') return Number.isFinite(m.pv) ? `${m.pv.toFixed(m.decimals ?? 1)}${m.unit}` : '—'
  return '—'
}

/** Feed tank and supply / Reactor train: the 8001 picture, scaled to fit, with live values and clickable equipment. */
export function FeedReactorPicture({ label }: { label: string }): JSX.Element {
  const modules = useStore((s) => s.modules)
  const alarms = useStore((s) => s.alarms)
  const batch = useStore((s) => s.batch)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const banner = `BATCH ${batch.id} · ${batch.status} · ${batch.recipe}`
  const phase = batch.phase ? `${batch.phase.name} · ${batch.phase.stepName}` : 'No active phase'
  return (
    <div className="display static-picture">
      <svg className="feed-reactor-svg" viewBox={`0 0 ${PICTURE_W} ${PICTURE_H}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label={label}>
        <image href={FEED_REACTOR_PICTURE} x={0} y={0} width={PICTURE_W} height={PICTURE_H} />
        <rect x={323} y={22} width={152} height={18} fill={PATCH} />
        <text x={399} y={30} className="pic-live pic-center" data-batch-banner>{banner}</text>
        <rect x={323} y={32} width={152} height={9} fill={PATCH} />
        <text x={399} y={38.5} className="pic-live pic-center pic-dim">{phase}</text>
        {READOUTS.map((r) => (
          <g key={r.tag} data-readout={r.tag}>
            {r.rows.map((row, i) => {
              const y = r.y + i * 8.4
              return (
                <g key={row}>
                  <rect x={r.x + 20} y={y - 6.4} width={r.w - 21} height={9.4} fill={PATCH} />
                  <text x={r.x + r.w - 3} y={y} className="pic-live pic-right" data-value={`${r.tag}.${row}`}>{value(modules[r.tag], row)}</text>
                </g>
              )
            })}
          </g>
        ))}
        {HOTSPOTS.map((h, i) => {
          const alarm = moduleAlarm(h.tag, alarms)
          return (
            <rect key={`${h.tag}-${i}`} x={h.x} y={h.y} width={h.w} height={h.h} rx={2}
              className={'pic-hot' + (alarm ? ` pic-alarm-${alarm.priority.toLowerCase()}` : '')}
              role="button" tabIndex={0} aria-label={h.label} data-tag={h.tag}
              onClick={() => openFaceplate(h.tag)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFaceplate(h.tag) } }}>
              <title>{h.label + (alarm ? ` — ${alarm.label}` : '')}</title>
            </rect>
          )
        })}
      </svg>
    </div>
  )
}
