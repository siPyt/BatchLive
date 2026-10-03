import type { AnalogSignalRef, AnyModule, PidBlockName } from './types'
import { pidIo } from './analogStrategy'
import { FB_NEEDS_IN2 } from './fb'

export interface DiagramBlock {
  id: string
  moduleTag: string
  name: string
  type: string
  part?: PidBlockName
}

export interface DiagramWire {
  key: string
  fromTag: string
  fromPort: 'out' | 'pv' | 'bkcal' | 'out1' | 'out2'
  toTag: string
  which: string
  feedback?: boolean
}

export function avoidSavedBlockOverlaps(
  automatic: Record<string, { x: number; y: number }>,
  saved: Record<string, { x: number; y: number }>,
  sizes: Record<string, { width: number; height: number }>
): Record<string, { x: number; y: number }> {
  const placed = Object.keys(automatic).filter(id => saved[id]).map(id => ({
    ...saved[id], ...sizes[id]
  }))
  const result = { ...automatic }
  for (const [id, position] of Object.entries(automatic)) {
    if (saved[id]) continue
    const candidate = { ...position, ...sizes[id] }
    const overlaps = (rect: typeof candidate): boolean =>
      candidate.x < rect.x + rect.width + 24 && candidate.x + candidate.width + 24 > rect.x &&
      candidate.y < rect.y + rect.height + 32 && candidate.y + candidate.height + 32 > rect.y
    let collision = placed.find(overlaps)
    while (collision) {
      candidate.y = collision.y + collision.height + 54
      collision = placed.find(overlaps)
    }
    result[id] = { x: candidate.x, y: candidate.y }
    placed.push(candidate)
  }
  return result
}

export function connectedModuleTags(modules: Record<string, AnyModule>, rootTag: string): string[] {
  const neighbors = new Map<string, Set<string>>()
  const connect = (tag: string, source: string | undefined): void => {
    if (!source || !modules[source]) return
    if (!neighbors.has(tag)) neighbors.set(tag, new Set())
    if (!neighbors.has(source)) neighbors.set(source, new Set())
    neighbors.get(tag)?.add(source)
    neighbors.get(source)?.add(tag)
  }
  for (const module of Object.values(modules)) {
    if (module.type === 'FB') {
      if (module.in1.kind === 'ref') connect(module.tag, module.in1.tag)
      if (FB_NEEDS_IN2[module.fbType] && module.in2.kind === 'ref') connect(module.tag, module.in2.tag)
      if (module.fbType === 'SPLTR') {
        connect(module.tag, module.bkcal1Source?.tag)
        connect(module.tag, module.bkcal2Source?.tag)
      }
    } else if (module.type === 'PID') {
      const io = pidIo(module)
      for (const source of [io.inputSource?.tag, io.outputSource?.tag, io.output2Source?.tag,
        module.casSource, module.ffSource, module.trackSource, module.trackValueSource]) {
        connect(module.tag, source)
      }
    } else if (module.type === 'MOTOR' || module.type === 'VALVE') {
      connect(module.tag, module.interlockSource)
      connect(module.tag, module.commandSource)
    }
  }
  const connected = new Set([rootTag])
  const pending = [rootTag]
  while (pending.length > 0) {
    const tag = pending.pop()
    if (!tag) continue
    for (const neighbor of neighbors.get(tag) ?? []) {
      if (connected.has(neighbor)) continue
      connected.add(neighbor)
      pending.push(neighbor)
    }
  }
  return [rootTag, ...Array.from(connected).filter(tag => tag !== rootTag).sort()]
}

export function moduleBlocks(m: AnyModule): DiagramBlock[] {
  if (m.type === 'PID') {
    const split = pidIo(m).splitter
    return [
      { id: `${m.tag}/AI1`, moduleTag: m.tag, name: 'AI1', type: 'AI', part: 'AI1' },
      { id: m.tag, moduleTag: m.tag, name: 'PID1', type: 'PID', part: 'PID1' },
      ...(split ? [{ id: `${m.tag}/SPLTR1`, moduleTag: m.tag, name: 'SPLTR1',
        type: 'SPLTR', part: 'SPLTR1' as const }] : []),
      { id: `${m.tag}/AO1`, moduleTag: m.tag, name: 'AO1', type: 'AO', part: 'AO1' },
      ...(split ? [{ id: `${m.tag}/AO2`, moduleTag: m.tag, name: 'AO2',
        type: 'AO', part: 'AO2' as const }] : [])
    ]
  }
  const type = m.type === 'FB' ? m.fbType : m.type === 'MOTOR' || m.type === 'VALVE' ? 'DC' : m.type
  return [{ id: m.tag, moduleTag: m.tag, name: m.tag, type }]
}

export function buildControlDiagram(tags: string[], modules: Record<string, AnyModule>): {
  blocks: Record<string, DiagramBlock>; wires: DiagramWire[]
} {
  const blocks: Record<string, DiagramBlock> = {}
  const wires: DiagramWire[] = []
  const visible = new Set(tags)
  const add = (toTag: string, which: string, source?: AnalogSignalRef): void => {
    if (!source || !visible.has(source.tag)) return
    const from = modules[source.tag]
    const fromTag = source.block && source.block !== 'PID1'
      ? `${source.tag}/${source.block}` : source.tag
    if (!from || !moduleBlocks(from).some(block => block.id === fromTag)) return
    wires.push({
      key: `${toTag}.${which}`,
      fromTag,
      fromPort: source.parameter === 'OUT_1' ? 'out1' : source.parameter === 'OUT_2' ? 'out2' :
        from?.type === 'PID' && source.parameter === 'PV' ? 'pv' :
          from?.type === 'FB' && from.fbType === 'SPLTR' ? 'out1' : 'out',
      toTag, which
    })
  }
  for (const tag of tags) {
    const m = modules[tag]
    if (!m) continue
    for (const block of moduleBlocks(m)) blocks[block.id] = block
    const ref = (source: string | undefined, parameter: AnalogSignalRef['parameter'] = 'OUT'): AnalogSignalRef | undefined =>
      source ? { tag: source, parameter: modules[source]?.type === 'AI' ? 'PV' : parameter } : undefined
    if (m.type === 'PID') {
      const io = pidIo(m)
      if (io.aiConnected) {
        if (io.inputSource) add(tag, 'pv', io.inputSource)
        else wires.push({ key: `${tag}.pv`, fromTag: `${tag}/AI1`, fromPort: 'out', toTag: tag, which: 'pv' })
      }
      if (io.aoConnected) {
        if (io.outputSource) add(`${tag}/AO1`, 'ao', io.outputSource)
        else wires.push({ key: `${tag}.ao`, fromTag: io.splitter ? `${tag}/SPLTR1` : tag,
          fromPort: io.splitter ? 'out1' : 'out', toTag: `${tag}/AO1`, which: 'ao' })
      }
      if (io.splitter) {
        if (io.splitter.inputConnected) {
          wires.push({ key: `${tag}.splitter`, fromTag: tag, fromPort: 'out',
            toTag: `${tag}/SPLTR1`, which: 'splitter' })
        }
        if (io.ao2Connected) {
          if (io.output2Source) add(`${tag}/AO2`, 'ao2', io.output2Source)
          else wires.push({ key: `${tag}.ao2`, fromTag: `${tag}/SPLTR1`, fromPort: 'out2',
            toTag: `${tag}/AO2`, which: 'ao2' })
        }
        for (const branch of [1, 2] as const) {
          if (!(branch === 1 ? io.splitter.feedback1Connected : io.splitter.feedback2Connected)) continue
          wires.push({ key: `${tag}.splitterFeedback${branch}`, fromTag: `${tag}/AO${branch}`,
            fromPort: 'bkcal', toTag: `${tag}/SPLTR1`, which: `splitterFeedback${branch}`, feedback: true })
        }
      }
      if (io.bkcalConnected) {
        wires.push({
          key: `${tag}.bkcal`, fromTag: io.splitter ? `${tag}/SPLTR1` : `${tag}/AO1`, fromPort: 'bkcal',
          toTag: tag, which: 'bkcal', feedback: true
        })
      }
      add(tag, 'cas', ref(m.casSource))
      add(tag, 'ff', ref(m.ffSource, modules[m.ffSource ?? '']?.type === 'PID' ? 'PV' : 'OUT'))
      add(tag, 'track', ref(m.trackSource, modules[m.trackSource ?? '']?.type === 'PID' ? 'PV' : 'OUT'))
      add(tag, 'trackValue', ref(m.trackValueSource, modules[m.trackValueSource ?? '']?.type === 'PID' ? 'PV' : 'OUT'))
    } else if (m.type === 'FB') {
      for (const which of ['in1', 'in2'] as const) {
        if (which === 'in2' && !FB_NEEDS_IN2[m.fbType]) continue
        const input = m[which]
        if (input.kind === 'ref') {
          const source = ref(input.tag, input.parameter ??
            (modules[input.tag ?? '']?.type === 'PID' ? 'PV' : 'OUT'))
          if (source) add(tag, which, { ...source, block: input.block })
        }
      }
      if (m.fbType === 'SPLTR') {
        add(tag, 'bkcal1', m.bkcal1Source)
        add(tag, 'bkcal2', m.bkcal2Source)
        for (const wire of wires.filter(wire => wire.toTag === tag &&
          (wire.which === 'bkcal1' || wire.which === 'bkcal2'))) {
          wire.fromPort = 'bkcal'
          wire.feedback = true
        }
      }
    } else if (m.type === 'MOTOR' || m.type === 'VALVE') {
      add(tag, 'ilk', ref(m.interlockSource, modules[m.interlockSource ?? '']?.type === 'PID' ? 'PV' : 'OUT'))
      add(tag, 'command', ref(m.commandSource, modules[m.commandSource ?? '']?.type === 'PID' ? 'PV' : 'OUT'))
    }
  }
  return { blocks, wires }
}
