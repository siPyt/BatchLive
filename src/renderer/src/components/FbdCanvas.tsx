import { useEffect, useRef, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { BUILTIN_TAGS } from '../engine/plant'
import { FB_NEEDS_IN2, isDiscreteModule, readModuleValue, outputPinLabel } from '../engine/fb'
import { fmt } from '../utils/format'
import type { AnyModule, FbInputRef } from '../engine/types'

// A true IEC 61131-3 / DeltaV-style Function Block Diagram node editor:
// draggable nodes, click-drag pin-to-pin wiring, orthogonal colored wires,
// and Delete-key removal — not a static picture of one module.

const NODE_W = 152
const HEADER_H = 20
const ROW_H = 15
const GRID_COLS = 4
const GRID_SPACING_X = 210
const GRID_SPACING_Y = 150
const CANVAS_W = 2200
const CANVAS_H = 1400

function nodeHeight(m: AnyModule): number {
  const pins = m.type === 'FB' ? (FB_NEEDS_IN2[m.fbType] ? 2 : 1) : m.type === 'PID' || m.type === 'MOTOR' || m.type === 'VALVE' ? 1 : 0
  return HEADER_H + ROW_H * 2 + pins * ROW_H + 6
}

function defaultPos(idx: number): { x: number; y: number } {
  const col = idx % GRID_COLS
  const row = Math.floor(idx / GRID_COLS)
  return { x: 40 + col * GRID_SPACING_X, y: 40 + row * GRID_SPACING_Y }
}

interface Wire {
  key: string
  fromTag: string
  toTag: string
  which: string
}

export function FbdCanvas({
  areaTags,
  selectedTag,
  onSelect
}: {
  areaTags: string[]
  selectedTag: string
  onSelect: (tag: string) => void
}): JSX.Element {
  const modules = useStore((s) => s.modules)
  const setFbInput = useStore((s) => s.setFbInput)
  const setCasSource = useStore((s) => s.setCasSource)
  const setInterlockSource = useStore((s) => s.setInterlockSource)
  const deleteModule = useStore((s) => s.deleteModule)
  const layout = useUi((s) => s.studioLayout)
  const setStudioLayout = useUi((s) => s.setStudioLayout)

  const svgRef = useRef<SVGSVGElement>(null)
  const [dragNode, setDragNode] = useState<{ tag: string; offX: number; offY: number } | null>(null)
  const [wiring, setWiring] = useState<{ fromTag: string; x: number; y: number; curX: number; curY: number } | null>(null)
  const [selectedWire, setSelectedWire] = useState<{ tag: string; which: string } | null>(null)

  const posOf = (tag: string): { x: number; y: number } => layout[tag] ?? defaultPos(areaTags.indexOf(tag))

  const toSvgPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect()
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) }
  }

  useEffect(() => {
    if (!dragNode) return
    const onMove = (e: MouseEvent): void => {
      const p = toSvgPoint(e)
      setStudioLayout(dragNode.tag, p.x - dragNode.offX, p.y - dragNode.offY)
    }
    const onUp = (): void => setDragNode(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragNode])

  useEffect(() => {
    if (!wiring) return
    const onMove = (e: MouseEvent): void => {
      const p = toSvgPoint(e)
      setWiring((w) => (w ? { ...w, curX: p.x, curY: p.y } : w))
    }
    const onUp = (): void => setWiring(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!wiring])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
      if (selectedWire) {
        if (selectedWire.which === 'cas') setCasSource(selectedWire.tag, undefined)
        else if (selectedWire.which === 'ilk') setInterlockSource(selectedWire.tag, undefined)
        else setFbInput(selectedWire.tag, selectedWire.which as 'in1' | 'in2', { kind: 'const', value: 0 })
        setSelectedWire(null)
      } else if (selectedTag && !BUILTIN_TAGS.has(selectedTag)) {
        deleteModule(selectedTag)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedWire, selectedTag, setFbInput, setCasSource, setInterlockSource, deleteModule])

  // Build the wire list from every FB block's IN1/IN2 refs, every PID's
  // CAS_SOURCE, and every MOTOR/VALVE's INTERLOCK_SOURCE that point at a tag on this canvas.
  const wires: Wire[] = []
  for (const tag of areaTags) {
    const m = modules[tag]
    if (!m) continue
    if (m.type === 'FB') {
      const check = (which: 'in1' | 'in2', ref: FbInputRef): void => {
        if (ref.kind === 'ref' && ref.tag && areaTags.includes(ref.tag)) {
          wires.push({ key: `${tag}.${which}`, fromTag: ref.tag, toTag: tag, which })
        }
      }
      check('in1', m.in1)
      check('in2', m.in2)
    } else if (m.type === 'PID' && m.casSource && areaTags.includes(m.casSource)) {
      wires.push({ key: `${tag}.cas`, fromTag: m.casSource, toTag: tag, which: 'cas' })
    } else if ((m.type === 'MOTOR' || m.type === 'VALVE') && m.interlockSource && areaTags.includes(m.interlockSource)) {
      wires.push({ key: `${tag}.ilk`, fromTag: m.interlockSource, toTag: tag, which: 'ilk' })
    }
  }

  const pinPos = (tag: string, which: string): { x: number; y: number } => {
    const p = posOf(tag)
    if (which === 'out') return { x: p.x + NODE_W, y: p.y + HEADER_H + ROW_H + ROW_H / 2 }
    const row = which === 'in1' || which === 'cas' || which === 'ilk' ? 0 : 1
    return { x: p.x, y: p.y + HEADER_H + ROW_H * 2 + row * ROW_H + ROW_H / 2 }
  }

  const beginWire = (fromTag: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    const anchor = pinPos(fromTag, 'out')
    const p = toSvgPoint(e)
    setWiring({ fromTag, x: anchor.x, y: anchor.y, curX: p.x, curY: p.y })
  }

  const dropWire = (toTag: string, which: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!wiring) return
    if (wiring.fromTag !== toTag) {
      if (which === 'cas') setCasSource(toTag, wiring.fromTag)
      else if (which === 'ilk') setInterlockSource(toTag, wiring.fromTag)
      else setFbInput(toTag, which as 'in1' | 'in2', { kind: 'ref', value: 0, tag: wiring.fromTag })
    }
    setWiring(null)
  }

  const beginDragNode = (tag: string, e: React.MouseEvent): void => {
    onSelect(tag)
    setSelectedWire(null)
    const p = toSvgPoint(e)
    const pos = posOf(tag)
    setDragNode({ tag, offX: p.x - pos.x, offY: p.y - pos.y })
  }

  const orthoPath = (x1: number, y1: number, x2: number, y2: number): string => {
    const midX = (x1 + x2) / 2
    return `M${x1},${y1} H${midX} V${y2} H${x2}`
  }

  return (
    <div className="fbd-canvas-scroll">
      <svg ref={svgRef} className="fbd-canvas-svg" width={CANVAS_W} height={CANVAS_H} onMouseDown={() => setSelectedWire(null)}>
        <defs>
          <pattern id="fbdDots" width={16} height={16} patternUnits="userSpaceOnUse">
            <circle cx={1.5} cy={1.5} r={1.5} fill="#cfcfd6" />
          </pattern>
          <filter id="fbdShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="1" dy="2" stdDeviation="1.5" floodColor="#000" floodOpacity="0.3" />
          </filter>
        </defs>
        <rect x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="url(#fbdDots)" />

        {wires.map((w) => {
          const a = pinPos(w.fromTag, 'out')
          const b = pinPos(w.toTag, w.which)
          const discrete = isDiscreteModule(modules[w.fromTag])
          const selected = selectedWire?.tag === w.toTag && selectedWire.which === w.which
          return (
            <path
              key={w.key}
              d={orthoPath(a.x, a.y, b.x, b.y)}
              fill="none"
              stroke={selected ? '#E6A400' : discrete ? '#2E6B4F' : '#005FB8'}
              strokeWidth={selected ? 2.5 : 2}
              style={{ cursor: 'pointer' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                setSelectedWire({ tag: w.toTag, which: w.which })
              }}
            />
          )
        })}

        {wiring && (
          <path d={orthoPath(wiring.x, wiring.y, wiring.curX, wiring.curY)} fill="none" stroke="#888" strokeWidth={2} strokeDasharray="4,3" />
        )}

        {areaTags.map((tag) => {
          const m = modules[tag]
          if (!m) return null
          const pos = posOf(tag)
          return (
            <FbNode
              key={tag}
              m={m}
              x={pos.x}
              y={pos.y}
              selected={tag === selectedTag}
              onHeaderDown={(e) => beginDragNode(tag, e)}
              onOutDown={(e) => beginWire(tag, e)}
              onIn1Up={
                m.type === 'FB'
                  ? (e) => dropWire(tag, 'in1', e)
                  : m.type === 'PID'
                    ? (e) => dropWire(tag, 'cas', e)
                    : m.type === 'MOTOR' || m.type === 'VALVE'
                      ? (e) => dropWire(tag, 'ilk', e)
                      : undefined
              }
              onIn2Up={m.type === 'FB' && FB_NEEDS_IN2[m.fbType] ? (e) => dropWire(tag, 'in2', e) : undefined}
            />
          )
        })}
      </svg>
    </div>
  )
}

function FbNode({
  m,
  x,
  y,
  selected,
  onHeaderDown,
  onOutDown,
  onIn1Up,
  onIn2Up
}: {
  m: AnyModule
  x: number
  y: number
  selected: boolean
  onHeaderDown: (e: React.MouseEvent) => void
  onOutDown: (e: React.MouseEvent) => void
  onIn1Up?: (e: React.MouseEvent) => void
  onIn2Up?: (e: React.MouseEvent) => void
}): JSX.Element {
  const h = nodeHeight(m)
  const badge = m.type === 'FB' ? m.fbType : m.type
  const outLabel = outputPinLabel(m)
  const liveValue = readModuleValue(m)
  const unit = m.type === 'PID' || m.type === 'AI' ? m.unit : ''
  const decimals = m.type === 'PID' || m.type === 'AI' ? m.decimals : m.type === 'FB' ? 2 : 0
  const bad = (m.type === 'PID' || m.type === 'AI') && m.pvBad
  const inputs: { label: string; up?: (e: React.MouseEvent) => void }[] =
    m.type === 'FB'
      ? FB_NEEDS_IN2[m.fbType]
        ? [{ label: 'IN1', up: onIn1Up }, { label: 'IN2', up: onIn2Up }]
        : [{ label: 'IN1', up: onIn1Up }]
      : m.type === 'PID'
        ? [{ label: 'CAS_IN', up: onIn1Up }]
        : m.type === 'MOTOR' || m.type === 'VALVE'
          ? [{ label: 'ILK', up: onIn1Up }]
          : []

  return (
    <g transform={`translate(${x},${y})`}>
      <rect x={0} y={0} width={NODE_W} height={h} fill="#E4E4E4" stroke={selected ? '#005FB8' : '#707070'} strokeWidth={selected ? 2 : 1} filter="url(#fbdShadow)" />
      <rect x={0} y={0} width={NODE_W} height={HEADER_H} fill="#D6D6D6" stroke="#707070" style={{ cursor: 'grab' }} onMouseDown={onHeaderDown} />
      <text x={5} y={14} fontSize={9} fontWeight={800} fill="#0a3d6b">
        [{badge}]
      </text>
      <text x={NODE_W - 5} y={14} fontSize={10} fontWeight={700} fill="#1a1a1a" textAnchor="end">
        {m.tag}
      </text>

      <text x={6} y={HEADER_H + ROW_H - 4} fontSize={11} fontWeight={700} fill={bad ? '#D9383A' : '#111111'} fontFamily="'Consolas', monospace">
        {bad ? '????' : `${fmt(liveValue, decimals)}${unit ? ' ' + unit : ''}`}
      </text>
      <text x={NODE_W - 6} y={HEADER_H + ROW_H * 2 - 4} fontSize={9} fontWeight={700} fill={bad ? '#D9383A' : '#1f8a4c'} textAnchor="end">
        {bad ? 'Bad' : 'Good'}
      </text>

      {inputs.map((inp, i) => (
        <g key={inp.label} transform={`translate(0, ${HEADER_H + ROW_H * 2 + i * ROW_H})`}>
          <polygon points="0,3 8,7.5 0,12" fill="#444" style={{ cursor: 'crosshair' }} onMouseUp={inp.up} />
          <rect x={0} y={0} width={16} height={ROW_H} fill="transparent" style={{ cursor: 'crosshair' }} onMouseUp={inp.up} />
          <text x={11} y={11} fontSize={8} fill="#333">
            {inp.label}
          </text>
        </g>
      ))}

      <g transform={`translate(${NODE_W - 16}, ${HEADER_H + ROW_H})`}>
        <polygon points="8,3 16,7.5 8,12" fill="#0a3d6b" style={{ cursor: 'crosshair' }} onMouseDown={onOutDown} />
        <rect x={0} y={0} width={16} height={ROW_H} fill="transparent" style={{ cursor: 'crosshair' }} onMouseDown={onOutDown} />
        <text x={-3} y={11} fontSize={8} fill="#333" textAnchor="end">
          {outLabel}
        </text>
      </g>
    </g>
  )
}
