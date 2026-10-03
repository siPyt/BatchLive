import { useEffect, useRef, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { BUILTIN_TAGS } from '../engine/plant'
import { FB_NEEDS_IN2, isDiscreteModule, readModuleValue, outputPinLabel } from '../engine/fb'
import { fmt } from '../utils/format'
import { FunctionBlockIcon, engineeringBlockType } from './EngineeringIcons'
import type { AnyModule, FbInputRef } from '../engine/types'

// A true IEC 61131-3 / DeltaV-style Function Block Diagram node editor:
// draggable nodes, click-drag pin-to-pin wiring, orthogonal colored wires,
// and Delete-key removal — not a static picture of one module.

const NODE_W = 188
const HEADER_H = 22
const ROW_H = 17
const CANVAS_W = 2200
const CANVAS_H = 1400

interface InputPort {
  which: string
  label: string
}

function inputPorts(m: AnyModule): InputPort[] {
  if (m.type === 'FB') {
    return [
      { which: 'in1', label: 'IN1' },
      ...(FB_NEEDS_IN2[m.fbType] ? [{ which: 'in2', label: 'IN2' }] : [])
    ]
  }
  if (m.type === 'PID') {
    return [
      { which: 'cas', label: 'CAS_IN' },
      { which: 'ff', label: 'FF_VAL' },
      { which: 'track', label: 'TRK_IN_D' },
      { which: 'trackValue', label: 'TRK_VAL' }
    ]
  }
  if (m.type === 'MOTOR' || m.type === 'VALVE') {
    return [
      { which: 'ilk', label: 'ILK' },
      { which: 'command', label: 'SP_D' }
    ]
  }
  return []
}

function nodeHeight(m: AnyModule): number {
  return HEADER_H + ROW_H * (2 + inputPorts(m).length) + 8
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
  const setFeedforward = useStore((s) => s.setFeedforward)
  const setTracking = useStore((s) => s.setTracking)
  const setInterlockSource = useStore((s) => s.setInterlockSource)
  const setCommandSource = useStore((s) => s.setCommandSource)
  const deleteModule = useStore((s) => s.deleteModule)
  const layout = useUi((s) => s.studioLayout)
  const setStudioLayout = useUi((s) => s.setStudioLayout)

  const svgRef = useRef<SVGSVGElement>(null)
  const [dragNode, setDragNode] = useState<{ tag: string; offX: number; offY: number } | null>(null)
  const [wiring, setWiring] = useState<{ fromTag: string; x: number; y: number; curX: number; curY: number } | null>(null)
  const [selectedWire, setSelectedWire] = useState<{ tag: string; which: string } | null>(null)

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
        else if (selectedWire.which === 'ff') setFeedforward(selectedWire.tag, { source: undefined })
        else if (selectedWire.which === 'track') setTracking(selectedWire.tag, { source: undefined })
        else if (selectedWire.which === 'trackValue') setTracking(selectedWire.tag, { valueSource: undefined })
        else if (selectedWire.which === 'ilk') setInterlockSource(selectedWire.tag, undefined)
        else if (selectedWire.which === 'command') setCommandSource(selectedWire.tag, undefined)
        else if (selectedWire.which === 'in1' || selectedWire.which === 'in2') {
          setFbInput(selectedWire.tag, selectedWire.which, { kind: 'const', value: 0 })
        }
        setSelectedWire(null)
      } else if (selectedTag && !BUILTIN_TAGS.has(selectedTag)) {
        deleteModule(selectedTag)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedWire, selectedTag, setFbInput, setCasSource, setFeedforward, setTracking, setInterlockSource, setCommandSource, deleteModule])

  // Draw every configured live reference so the canvas reflects the same
  // cascade, feedforward, tracking, interlock, and command wiring as the engine.
  const wires: Wire[] = []
  for (const tag of areaTags) {
    const m = modules[tag]
    if (!m) continue
    const addWire = (which: string, source: string | undefined): void => {
      if (source && areaTags.includes(source)) wires.push({ key: `${tag}.${which}`, fromTag: source, toTag: tag, which })
    }
    if (m.type === 'FB') {
      const check = (which: 'in1' | 'in2', ref: FbInputRef): void => {
        if (ref.kind === 'ref') addWire(which, ref.tag)
      }
      check('in1', m.in1)
      check('in2', m.in2)
    } else if (m.type === 'PID') {
      addWire('cas', m.casSource)
      addWire('ff', m.ffSource)
      addWire('track', m.trackSource)
      addWire('trackValue', m.trackValueSource)
    } else if (m.type === 'MOTOR' || m.type === 'VALVE') {
      addWire('ilk', m.interlockSource)
      addWire('command', m.commandSource)
    }
  }

  const autoPositions = getAutoPositions(areaTags, wires, modules)
  const posOf = (tag: string): { x: number; y: number } => layout[tag] ?? autoPositions[tag] ?? { x: 48, y: 48 }
  const canvasWidth = Math.max(CANVAS_W, ...areaTags.map((tag) => posOf(tag).x + NODE_W + 80))
  const canvasHeight = Math.max(CANVAS_H, ...areaTags.map((tag) => posOf(tag).y + nodeHeight(modules[tag]) + 80))

  const pinPos = (tag: string, which: string): { x: number; y: number } => {
    const p = posOf(tag)
    if (which === 'out') return { x: p.x + NODE_W, y: p.y + HEADER_H + ROW_H + ROW_H / 2 }
    const ports = inputPorts(modules[tag])
    const row = Math.max(0, ports.findIndex((port) => port.which === which))
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
      else if (which === 'ff') setFeedforward(toTag, { source: wiring.fromTag })
      else if (which === 'track') setTracking(toTag, { source: wiring.fromTag })
      else if (which === 'trackValue') setTracking(toTag, { valueSource: wiring.fromTag })
      else if (which === 'ilk') setInterlockSource(toTag, wiring.fromTag)
      else if (which === 'command') setCommandSource(toTag, wiring.fromTag)
      else if (which === 'in1' || which === 'in2') setFbInput(toTag, which, { kind: 'ref', value: 0, tag: wiring.fromTag })
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
      <svg ref={svgRef} className="fbd-canvas-svg" width={canvasWidth} height={canvasHeight} onMouseDown={() => setSelectedWire(null)}>
        <defs>
          <pattern id="fbdGrid" width={20} height={20} patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e7e9eb" strokeWidth={0.7} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill="url(#fbdGrid)" />

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
              onInputUp={(which, e) => dropWire(tag, which, e)}
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
  onInputUp
}: {
  m: AnyModule
  x: number
  y: number
  selected: boolean
  onHeaderDown: (e: React.MouseEvent) => void
  onOutDown: (e: React.MouseEvent) => void
  onInputUp: (which: string, e: React.MouseEvent) => void
}): JSX.Element {
  const h = nodeHeight(m)
  const badge = engineeringBlockType(m)
  const outLabel = outputPinLabel(m)
  const liveValue = readModuleValue(m)
  const unit = m.type === 'PID' || m.type === 'AI' ? m.unit : ''
  const decimals = m.type === 'PID' || m.type === 'AI' ? m.decimals : m.type === 'FB' ? 2 : 0
  const bad = (m.type === 'PID' || m.type === 'AI') && m.pvBad
  const inputs = inputPorts(m)

  return (
    <g transform={`translate(${x},${y})`}>
      <title>{m.description}</title>
      <rect x={0} y={0} width={NODE_W} height={h} fill="#F4F5F6" stroke={selected ? '#005FB8' : '#707070'} strokeWidth={selected ? 2 : 1} />
      <rect x={0} y={0} width={NODE_W} height={HEADER_H} fill="#E2E5E7" stroke="#707070" style={{ cursor: 'grab' }} onMouseDown={onHeaderDown} />
      <FunctionBlockIcon type={badge} size={18} x={3} y={2} />
      <text x={NODE_W - 5} y={14} fontSize={10} fontWeight={700} fill="#1a1a1a" textAnchor="end">
        {m.tag}
      </text>

      <text x={6} y={HEADER_H + ROW_H - 4} fontSize={11} fontWeight={700} fill={bad ? '#D9383A' : '#111111'} fontFamily="'Consolas', monospace">
        {bad ? '????' : `${fmt(liveValue, decimals)}${unit ? ' ' + unit : ''}`}
      </text>
      <text x={NODE_W - 6} y={HEADER_H + ROW_H * 2 - 4} fontSize={9} fontWeight={700} fill={bad ? '#D9383A' : '#1f8a4c'} textAnchor="end">
        {bad ? 'Bad' : 'Good'}
      </text>

      {inputs.map((inp, i) => {
        const onMouseUp = (e: React.MouseEvent): void => onInputUp(inp.which, e)
        return (
          <g key={inp.which} transform={`translate(0, ${HEADER_H + ROW_H * 2 + i * ROW_H})`}>
            <polygon points="0,3 8,8.5 0,14" fill="#444" style={{ cursor: 'crosshair' }} onMouseUp={onMouseUp} />
            <rect x={0} y={0} width={16} height={ROW_H} fill="transparent" style={{ cursor: 'crosshair' }} onMouseUp={onMouseUp} />
            <text x={11} y={12} fontSize={8} fill="#333">
              {inp.label}
            </text>
          </g>
        )
      })}

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

function getAutoPositions(tags: string[], wires: Wire[], modules: Record<string, AnyModule>): Record<string, { x: number; y: number }> {
  const indegree = new Map(tags.map((tag) => [tag, 0]))
  const outgoing = new Map(tags.map((tag) => [tag, [] as string[]]))
  for (const wire of wires) {
    outgoing.get(wire.fromTag)?.push(wire.toTag)
    indegree.set(wire.toTag, (indegree.get(wire.toTag) ?? 0) + 1)
  }

  const ready = tags.filter((tag) => indegree.get(tag) === 0).sort()
  const rank = new Map(tags.map((tag) => [tag, 0]))
  const visited = new Set<string>()
  while (ready.length > 0) {
    const tag = ready.shift()
    if (!tag) continue
    visited.add(tag)
    for (const target of outgoing.get(tag) ?? []) {
      rank.set(target, Math.max(rank.get(target) ?? 0, (rank.get(tag) ?? 0) + 1))
      const remaining = (indegree.get(target) ?? 0) - 1
      indegree.set(target, remaining)
      if (remaining === 0) {
        ready.push(target)
        ready.sort()
      }
    }
  }

  const cyclicTags = tags.filter((tag) => !visited.has(tag)).sort()
  if (cyclicTags.length > 0) {
    const lastRank = Math.max(0, ...rank.values()) + 1
    for (const tag of cyclicTags) rank.set(tag, lastRank)
  }

  const layers = new Map<number, string[]>()
  for (const tag of tags) {
    const layer = rank.get(tag) ?? 0
    if (!layers.has(layer)) layers.set(layer, [])
    layers.get(layer)?.push(tag)
  }

  const positions: Record<string, { x: number; y: number }> = {}
  for (const [layer, layerTags] of layers) {
    layerTags.sort()
    const layerHeight = Math.max(...layerTags.map((tag) => nodeHeight(modules[tag])))
    layerTags.forEach((tag, index) => {
      positions[tag] = {
        x: 56 + layer * (NODE_W + 96),
        y: 48 + index * (layerHeight + 42)
      }
    })
  }
  return positions
}
