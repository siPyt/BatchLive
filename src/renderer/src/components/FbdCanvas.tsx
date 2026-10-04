import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { BUILTIN_TAGS } from '../engine/plant'
import { FB_NEEDS_IN2, isDiscreteModule, readModuleValue, outputPinLabel } from '../engine/fb'
import { fmt } from '../utils/format'
import { FunctionBlockIcon } from './EngineeringIcons'
import { pidIo } from '../engine/analogStrategy'
import { avoidSavedBlockOverlaps, buildControlDiagram, type DiagramBlock, type DiagramWire } from '../engine/controlDiagram'
import type { AnalogSignalRef, AnyModule, PidBlockName } from '../engine/types'
import { lifecycleModules } from '../engine/moduleLifecycle'

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

function inputPorts(m: AnyModule, part?: PidBlockName): InputPort[] {
  if (m.type === 'AO') return [{ which: 'standaloneCas', label: 'CAS_IN' }]
  if (m.type === 'FB') {
    if (m.fbType === 'SPLTR') return [
      { which: 'in1', label: 'CAS_IN' }, { which: 'bkcal1', label: 'BKCAL_IN_1' },
      { which: 'bkcal2', label: 'BKCAL_IN_2' }
    ]
    return [
      { which: 'in1', label: 'IN1' },
      ...(FB_NEEDS_IN2[m.fbType] ? [{ which: 'in2', label: 'IN2' }] : [])
    ]
  }
  if (m.type === 'PID') {
    if (part === 'AI1') return []
    if (part === 'AO1' || part === 'AO2') return [
      { which: part === 'AO1' ? 'ao' : 'ao2', label: 'CAS_IN' }
    ]
    if (part === 'SPLTR1') return [
      { which: 'splitter', label: 'CAS_IN' },
      { which: 'splitterFeedback1', label: 'BKCAL_IN_1' },
      { which: 'splitterFeedback2', label: 'BKCAL_IN_2' }
    ]
    return [
      { which: 'pv', label: 'IN' },
      { which: 'bkcal', label: 'BKCAL_IN' },
      { which: 'cas', label: 'CAS_IN' },
      { which: 'ff', label: 'FF_VAL' },
      { which: 'track', label: 'TRK_IN_D' },
      { which: 'trackValue', label: 'TRK_VAL' }
    ]
  }
  if (m.type === 'MOTOR' || m.type === 'VALVE') {
    return [
      { which: 'ilk', label: 'ILK' },
      { which: 'permissive', label: 'PERMISSIVE_D' },
      { which: 'command', label: 'SP_D' }
    ]
  }
  return []
}

function outputPorts(m: AnyModule, part?: PidBlockName): {
  which: DiagramWire['fromPort']; label: string
}[] {
  if (m.type === 'AO') return [{ which: 'out', label: 'OUT' }, { which: 'pv', label: 'PV' }]
  if (m.type === 'PID') {
    if (part === 'AI1') return [{ which: 'out', label: 'OUT' }]
    if (part === 'AO1' || part === 'AO2') return [
      { which: 'out', label: 'OUT' }, { which: 'bkcal', label: 'BKCAL_OUT' }
    ]
    if (part === 'SPLTR1') return [
      { which: 'out1', label: 'OUT_1' }, { which: 'out2', label: 'OUT_2' },
      { which: 'bkcal', label: 'BKCAL_OUT' }
    ]
    return [{ which: 'out', label: 'OUT' }, { which: 'pv', label: 'PV' }]
  }
  if (m.type === 'FB' && m.fbType === 'SPLTR') return [
    { which: 'out1', label: 'OUT_1' }, { which: 'out2', label: 'OUT_2' },
    { which: 'bkcal', label: 'BKCAL_OUT' }
  ]
  return [{ which: 'out', label: outputPinLabel(m) }]
}

function nodeHeight(m: AnyModule, part?: PidBlockName): number {
  const rows = Math.max(inputPorts(m, part).length, outputPorts(m, part).length - 1)
  return HEADER_H + ROW_H * (2 + rows) + 8
}

export function FbdCanvas({
  areaTags,
  selectedTag,
  onSelect,
  selectedBlock = 'PID1',
  zoom = 1
}: {
  areaTags: string[]
  selectedTag: string
  onSelect: (tag: string, block?: PidBlockName) => void
  selectedBlock?: PidBlockName
  zoom?: number
}): JSX.Element {
  const runtimeModules = useStore((s) => s.modules)
  const moduleLifecycle = useStore(s => s.moduleLifecycle)
  const modules = useMemo(() => lifecycleModules({ modules: runtimeModules, moduleLifecycle }, selectedTag),
    [runtimeModules, moduleLifecycle, selectedTag])
  const setFbInput = useStore((s) => s.setFbInput)
  const setCasSource = useStore((s) => s.setCasSource)
  const setFeedforward = useStore((s) => s.setFeedforward)
  const setTracking = useStore((s) => s.setTracking)
  const setInterlockSource = useStore((s) => s.setInterlockSource)
  const setPermissiveSource = useStore(s => s.setPermissiveSource)
  const setCommandSource = useStore((s) => s.setCommandSource)
  const setPidIo = useStore((s) => s.setPidIo)
  const connectAoParameter = useStore(s => s.connectAoParameter)
  const setSplitterConfig = useStore((s) => s.setSplitterConfig)
  const logEvent = useStore((s) => s.logEvent)
  const deleteModule = useStore((s) => s.deleteModule)
  const layout = useUi((s) => s.studioLayout)
  const setStudioLayout = useUi((s) => s.setStudioLayout)

  const svgRef = useRef<SVGSVGElement>(null)
  const [dragNode, setDragNode] = useState<{ tag: string; offX: number; offY: number } | null>(null)
  const [wiring, setWiring] = useState<{
    fromTag: string; fromPort: DiagramWire['fromPort']; x: number; y: number; curX: number; curY: number
  } | null>(null)
  const [selectedWire, setSelectedWire] = useState<{ tag: string; id: string; which: string } | null>(null)

  const toSvgPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = svgRef.current?.getBoundingClientRect()
    return { x: (e.clientX - (rect?.left ?? 0)) / zoom, y: (e.clientY - (rect?.top ?? 0)) / zoom }
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
  }, [dragNode, zoom])

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
  }, [!!wiring, zoom])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
      if (selectedWire) {
        if (selectedWire.which === 'standaloneCas') connectAoParameter(selectedWire.tag, undefined)
        else if (selectedWire.which === 'pv') {
          setPidIo(selectedWire.tag, { aiConnected: false, inputSource: undefined })
        } else if (selectedWire.which === 'ao') {
          setPidIo(selectedWire.tag, { aoConnected: false, outputSource: undefined })
        } else if (selectedWire.which === 'ao2') {
          setPidIo(selectedWire.tag, { ao2Connected: false, output2Source: undefined })
        } else if (selectedWire.which === 'splitter') {
          setPidIo(selectedWire.tag, { splitter: { inputConnected: false } })
        } else if (selectedWire.which === 'splitterFeedback1' || selectedWire.which === 'splitterFeedback2') {
          setPidIo(selectedWire.tag, { splitter: selectedWire.which === 'splitterFeedback1'
            ? { feedback1Connected: false } : { feedback2Connected: false } })
        } else if (selectedWire.which === 'bkcal1' || selectedWire.which === 'bkcal2') {
          setSplitterConfig(selectedWire.tag, selectedWire.which === 'bkcal1'
            ? { feedback1Source: undefined } : { feedback2Source: undefined })
        } else if (selectedWire.which === 'bkcal') setPidIo(selectedWire.tag, { bkcalConnected: false })
        else if (selectedWire.which === 'cas') setCasSource(selectedWire.tag, undefined)
        else if (selectedWire.which === 'ff') setFeedforward(selectedWire.tag, { source: undefined })
        else if (selectedWire.which === 'track') setTracking(selectedWire.tag, { source: undefined })
        else if (selectedWire.which === 'trackValue') setTracking(selectedWire.tag, { valueSource: undefined })
        else if (selectedWire.which === 'ilk') setInterlockSource(selectedWire.tag, undefined)
        else if (selectedWire.which === 'permissive') setPermissiveSource(selectedWire.tag, undefined)
        else if (selectedWire.which === 'command') setCommandSource(selectedWire.tag, undefined)
        else if (selectedWire.which === 'in1' || selectedWire.which === 'in2') {
          setFbInput(selectedWire.tag, selectedWire.which, { kind: 'const', value: 0 })
        }
        setSelectedWire(null)
      } else if (selectedTag && modules[selectedTag]?.type !== 'PID' &&
          modules[selectedTag]?.type !== 'AO' && !BUILTIN_TAGS.has(selectedTag)) {
        deleteModule(selectedTag)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedWire, selectedTag, modules, setPidIo, connectAoParameter, setSplitterConfig, setFbInput, setCasSource, setFeedforward, setTracking, setInterlockSource, setPermissiveSource, setCommandSource, deleteModule])

  // Draw every configured live reference so the canvas reflects the same
  // cascade, feedforward, tracking, interlock, and command wiring as the engine.
  const { blocks, wires } = buildControlDiagram(areaTags, modules)
  const blockIds = Object.keys(blocks)
  const sizes = Object.fromEntries(blockIds.map(id => [id, {
    width: NODE_W, height: nodeHeight(modules[blocks[id].moduleTag], blocks[id].part)
  }]))
  const autoPositions = avoidSavedBlockOverlaps(
    getAutoPositions(blockIds, wires, modules, blocks), layout, sizes)
  const posOf = (tag: string): { x: number; y: number } => layout[tag] ?? autoPositions[tag] ?? { x: 48, y: 48 }
  const canvasWidth = Math.max(CANVAS_W, ...blockIds.map((tag) => posOf(tag).x + NODE_W + 80))
  const canvasHeight = Math.max(CANVAS_H, ...blockIds.map((tag) =>
    posOf(tag).y + nodeHeight(modules[blocks[tag].moduleTag], blocks[tag].part) + 100))

  const pinPos = (tag: string, which: string, output = false): { x: number; y: number } => {
    const p = posOf(tag)
    const block = blocks[tag]
    const m = modules[block.moduleTag]
    if (output) {
      const row = block.parameter ? 0 :
        Math.max(0, outputPorts(m, block.part).findIndex((port) => port.which === which))
      return { x: p.x + NODE_W, y: p.y + HEADER_H + ROW_H * (1 + row) + ROW_H / 2 }
    }
    const ports = inputPorts(m, block.part)
    const row = Math.max(0, ports.findIndex((port) => port.which === which))
    return { x: p.x, y: p.y + HEADER_H + ROW_H * 2 + row * ROW_H + ROW_H / 2 }
  }

  const beginWire = (fromTag: string, fromPort: DiagramWire['fromPort'], e: React.MouseEvent): void => {
    e.stopPropagation()
    const anchor = pinPos(fromTag, fromPort, true)
    const p = toSvgPoint(e)
    setWiring({ fromTag, fromPort, x: anchor.x, y: anchor.y, curX: p.x, curY: p.y })
  }

  const dropWire = (toTag: string, which: string, e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!wiring) return
    setWiring(null)
    const from = blocks[wiring.fromTag]
    const to = blocks[toTag]
    const sameModule = from.moduleTag === to.moduleTag
    const reject = (message: string): void => {
      logEvent('DIAGNOSTIC', to.moduleTag, `Connection rejected: ${message}`)
      window.alert(message)
    }
    const source: AnalogSignalRef = {
      tag: from.moduleTag, parameter: wiring.fromPort === 'pv' ? 'PV' :
        wiring.fromPort === 'out1' ? 'OUT_1' : wiring.fromPort === 'out2' ? 'OUT_2' : 'OUT',
      block: from.part
    }
    if (which === 'standaloneCas') {
      if (sameModule && from.parameter) connectAoParameter(to.moduleTag, from.parameter)
      else reject('Standalone AO.CAS_IN currently accepts a Floating Point input parameter in this module')
      return
    }
    if (from.parameter) {
      reject('This input parameter must be connected to its standalone AO.CAS_IN')
      return
    }
    if (which === 'splitterFeedback1' || which === 'splitterFeedback2') {
      const first = which === 'splitterFeedback1'
      if (sameModule && from.part === (first ? 'AO1' : 'AO2') && wiring.fromPort === 'bkcal') {
        setPidIo(to.moduleTag, { splitter: first
          ? { feedback1Connected: true } : { feedback2Connected: true } })
      } else reject('SPLTR feedback must come from its corresponding AO.BKCAL_OUT')
      return
    }
    if (which === 'bkcal1' || which === 'bkcal2') {
      if ((from.part === 'AO1' || from.part === 'AO2') && wiring.fromPort === 'bkcal') {
        setSplitterConfig(to.moduleTag, which === 'bkcal1'
          ? { feedback1Source: source } : { feedback2Source: source })
      } else reject('SPLTR feedback must come from an AO.BKCAL_OUT')
      return
    }
    if (which === 'bkcal') {
      const m = modules[to.moduleTag]
      const expected = m.type === 'PID' && pidIo(m).splitter ? 'SPLTR1' : 'AO1'
      if (sameModule && from.part === expected && wiring.fromPort === 'bkcal') {
        setPidIo(to.moduleTag, { bkcalConnected: true })
      } else reject(`PID.BKCAL_IN accepts the same module ${expected}.BKCAL_OUT`)
      return
    }
    if (wiring.fromPort === 'bkcal') {
      reject('BKCAL_OUT is feedback, not a command or measurement signal')
      return
    }
    if (which === 'splitter') {
      if (sameModule && from.part === 'PID1' && wiring.fromPort === 'out') {
        setPidIo(to.moduleTag, { splitter: { inputConnected: true } })
      } else reject('SPLTR1.CAS_IN accepts the same module PID1.OUT')
      return
    }
    if (which === 'pv' || which === 'ao' || which === 'ao2') {
      const m = modules[to.moduleTag]
      const split = m.type === 'PID' && !!pidIo(m).splitter
      const internal = sameModule && (which === 'pv'
        ? from.part === 'AI1' && wiring.fromPort === 'out'
        : split ? from.part === 'SPLTR1' && wiring.fromPort === (which === 'ao' ? 'out1' : 'out2')
          : from.part === 'PID1' && wiring.fromPort === 'out')
      setPidIo(to.moduleTag, which === 'pv'
        ? { aiConnected: true, inputSource: internal ? undefined : source }
        : which === 'ao' ? { aoConnected: true, outputSource: internal ? undefined : source }
          : { ao2Connected: true, output2Source: internal ? undefined : source })
      return
    }
    if (which === 'in1' || which === 'in2') {
      setFbInput(to.moduleTag, which, {
        kind: 'ref', value: 0, tag: from.moduleTag,
        ...(from.part || wiring.fromPort === 'out1' || wiring.fromPort === 'out2'
          ? { parameter: source.parameter, block: from.part } : {})
      })
      return
    }
    if (modules[from.moduleTag].type === 'AO' && wiring.fromPort === 'pv') {
      reject('This input uses module.OUT. Use AO.OUT, or connect AO.PV through an explicit PID input or FB reference.')
      return
    }
    if ((from.part && from.part !== 'PID1') || wiring.fromPort === 'out2' ||
        (from.part === 'PID1' && wiring.fromPort !== (which === 'cas' ? 'out' : 'pv'))) {
      reject('This input uses a live module value. Use PID.PV, a separate AI, or a logic block.')
      return
    }
    if (which === 'cas') setCasSource(to.moduleTag, from.moduleTag)
    else if (which === 'ff') setFeedforward(to.moduleTag, { source: from.moduleTag })
    else if (which === 'track') setTracking(to.moduleTag, { source: from.moduleTag })
    else if (which === 'trackValue') setTracking(to.moduleTag, { valueSource: from.moduleTag })
    else if (which === 'ilk') setInterlockSource(to.moduleTag, from.moduleTag)
    else if (which === 'permissive') setPermissiveSource(to.moduleTag, from.moduleTag)
    else if (which === 'command') setCommandSource(to.moduleTag, from.moduleTag)
  }

  const beginDragNode = (tag: string, e: React.MouseEvent): void => {
    onSelect(blocks[tag].moduleTag, blocks[tag].part)
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
      <svg ref={svgRef} className="fbd-canvas-svg" width={canvasWidth * zoom} height={canvasHeight * zoom} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} onMouseDown={() => setSelectedWire(null)}>
        <defs>
          <pattern id="fbdGrid" width={20} height={20} patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e7e9eb" strokeWidth={0.7} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={canvasWidth} height={canvasHeight} fill="url(#fbdGrid)" />

        {wires.map((w) => {
          const a = pinPos(w.fromTag, w.fromPort, true)
          const b = pinPos(w.toTag, w.which)
          const source = blocks[w.fromTag]
          const target = blocks[w.toTag]
          const discrete = !source.part && !source.parameter && isDiscreteModule(modules[source.moduleTag])
          const selected = selectedWire?.id === w.toTag && selectedWire.which === w.which
          const feedbackY = Math.max(
            posOf(w.fromTag).y + nodeHeight(modules[source.moduleTag], source.part),
            posOf(w.toTag).y + nodeHeight(modules[target.moduleTag], target.part)
          ) + 22
          return (
            <path
              key={w.key}
              d={w.feedback
                ? `M${a.x},${a.y} H${a.x + 24} V${feedbackY} H${b.x - 24} V${b.y} H${b.x}`
                : orthoPath(a.x, a.y, b.x, b.y)}
              fill="none"
              stroke={selected ? '#E6A400' : discrete ? '#2E6B4F' : '#005FB8'}
              strokeWidth={selected ? 2.5 : 2}
              strokeDasharray={w.feedback ? '6 4' : undefined}
              data-wire={w.key}
              style={{ cursor: 'pointer' }}
              onMouseDown={(e) => {
                e.stopPropagation()
                setSelectedWire({ tag: target.moduleTag, id: w.toTag, which: w.which })
              }}
            />
          )
        })}

        {wiring && (
          <path d={orthoPath(wiring.x, wiring.y, wiring.curX, wiring.curY)} fill="none" stroke="#888" strokeWidth={2} strokeDasharray="4,3" />
        )}

        {blockIds.map((tag) => {
          const block = blocks[tag]
          const m = modules[block.moduleTag]
          if (!m) return null
          const pos = posOf(tag)
          return (
            <FbNode
              key={tag}
              m={m}
              block={block}
              x={pos.x}
              y={pos.y}
              selected={block.moduleTag === selectedTag && (!block.part || block.part === selectedBlock)}
              onHeaderDown={(e) => beginDragNode(tag, e)}
              onOutDown={(port, e) => beginWire(tag, port, e)}
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
  block,
  x,
  y,
  selected,
  onHeaderDown,
  onOutDown,
  onInputUp
}: {
  m: AnyModule
  block: DiagramBlock
  x: number
  y: number
  selected: boolean
  onHeaderDown: (e: React.MouseEvent) => void
  onOutDown: (port: DiagramWire['fromPort'], e: React.MouseEvent) => void
  onInputUp: (which: string, e: React.MouseEvent) => void
}): JSX.Element {
  const h = nodeHeight(m, block.part)
  const badge = block.type
  const io = m.type === 'PID' ? pidIo(m) : undefined
  const inputStage = block.part === 'AI1'
  const outputStage = block.part === 'AO1' || block.part === 'AO2'
  const ao = block.part === 'AO2' ? io?.ao2 : io?.ao
  const split = block.part === 'SPLTR1' ? io?.splitter : undefined
  const parameter = m.type === 'AO' && block.parameter ? m.parameters[block.parameter] : undefined
  const liveValue = parameter ? parameter.value : m.type === 'PID' && io
    ? inputStage ? io.ai.out : outputStage ? ao?.out ?? NaN :
      split ? split.sp : m.out : readModuleValue(m)
  const unit = m.type === 'PID' ? inputStage ? m.unit : '%' :
    m.type === 'AO' ? parameter ? m.unit : '%' : m.type === 'AI' ? m.unit : ''
  const decimals = m.type === 'PID' ? inputStage ? m.decimals : 1 :
    m.type === 'AI' || m.type === 'AO' ? m.decimals : m.type === 'FB' ? 2 : 0
  const bad = parameter ? !Number.isFinite(parameter.value) : m.type === 'PID' && io
    ? inputStage ? io.ai.bad : outputStage ? ao?.bad ?? true :
      split ? split.status === 'BAD' : m.pvBad
    : m.type === 'AI' ? m.pvBad : m.type === 'FB' || m.type === 'AO' ? !!m.bad :
      m.type === 'DI' || m.type === 'DO' ? !!m.ioBad :
        m.type === 'MOTOR' || m.type === 'VALVE' ? !!m.ioInputBad || !!m.ioOutputBad : false
  const inputs = parameter ? [] : inputPorts(m, block.part)
  const outputs = parameter ? [{ which: 'out' as const, label: 'CV' }] : outputPorts(m, block.part)

  return (
    <g transform={`translate(${x},${y})`} data-block-id={block.id} data-block-type={badge}>
      <title>{m.description}{block.part ? ` — ${m.tag}/${block.part}` : ''}</title>
      <text x={NODE_W / 2} y={-7} fontSize={10} fill="#303030" textAnchor="middle">{badge}</text>
      <rect x={0} y={0} width={NODE_W} height={h} fill="#eceeef" stroke={selected ? '#005FB8' : '#414141'} strokeWidth={selected ? 2 : 1} />
      <rect x={0} y={0} width={NODE_W} height={HEADER_H} fill="#e4e6e7" stroke="#626262" style={{ cursor: 'grab' }} onMouseDown={onHeaderDown} />
      <FunctionBlockIcon type={badge} size={18} x={NODE_W - 20} y={2} />
      <text x={7} y={14} fontSize={block.name.length > 23 ? 8 : 10} fontWeight={600} fill="#1a1a1a" style={{ pointerEvents: 'none' }}>
        {block.name}
      </text>
      <path d={`M0,${HEADER_H + ROW_H} H${NODE_W} M0,${HEADER_H + ROW_H * 2} H${NODE_W}`} stroke="#a3a6a8" strokeWidth={0.6} />
      <text x={7} y={HEADER_H + ROW_H - 4} fontSize={10} fill={bad ? '#D9383A' : '#111111'} fontFamily="'Consolas', monospace">
        {bad ? '????' : `${fmt(liveValue, decimals)}${unit ? ' ' + unit : ''}`}
      </text>
      <text x={NODE_W - 7} y={HEADER_H + ROW_H - 4} fontSize={8} fill={bad ? '#D9383A' : '#485248'} textAnchor="end">
        {bad ? 'Bad' : 'Good'}
      </text>

      {inputs.map((inp, i) => {
        const onMouseUp = (e: React.MouseEvent): void => onInputUp(inp.which, e)
        return (
          <g key={inp.which} data-input-port={inp.which} transform={`translate(0, ${HEADER_H + ROW_H * 2 + i * ROW_H})`}>
            <path d="M-4,8.5 H4 M0,5 V12" stroke="#333" strokeWidth={1} style={{ cursor: 'crosshair' }} onMouseUp={onMouseUp} />
            <rect x={0} y={0} width={16} height={ROW_H} fill="transparent" style={{ cursor: 'crosshair' }} onMouseUp={onMouseUp} />
            <text x={11} y={12} fontSize={8} fill="#333">
              {inp.label}
            </text>
          </g>
        )
      })}

      {outputs.map((output, index) => (
        <g key={output.which} data-output-port={output.which}
          transform={`translate(${NODE_W - 16}, ${HEADER_H + ROW_H * (1 + index)})`}>
          <path d="M12,8.5 H20 M16,5 V12" stroke="#333" strokeWidth={1} />
          <rect x={0} y={0} width={21} height={ROW_H} fill="transparent"
            style={{ cursor: 'crosshair' }} onMouseDown={(e) => onOutDown(output.which, e)} />
          <text x={-3} y={11} fontSize={8} fill="#333" textAnchor="end">{output.label}</text>
        </g>
      ))}
      {block.part && <text x={NODE_W / 2} y={h + 13} fontSize={9} fill="#303030"
        textAnchor="middle">{m.tag}/{block.part}</text>}
      {m.type === 'AO' && <text x={NODE_W / 2} y={h + 13} fontSize={9} fill="#303030"
        textAnchor="middle">{m.tag}/{block.parameter ?? 'AO1'}</text>}
    </g>
  )
}

function getAutoPositions(
  tags: string[], wires: DiagramWire[], modules: Record<string, AnyModule>,
  blocks: Record<string, DiagramBlock>
): Record<string, { x: number; y: number }> {
  const indegree = new Map(tags.map((tag) => [tag, 0]))
  const outgoing = new Map(tags.map((tag) => [tag, [] as string[]]))
  for (const wire of wires) {
    if (wire.feedback) continue
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
    const layerHeight = Math.max(...layerTags.map((tag) =>
      nodeHeight(modules[blocks[tag].moduleTag], blocks[tag].part)))
    layerTags.forEach((tag, index) => {
      positions[tag] = {
        x: 56 + layer * (NODE_W + 96),
        y: 48 + index * (layerHeight + 54)
      }
    })
  }
  return positions
}
