import { newStep, parallelGraphError, sequentialTarget, type SfcCondition, type SfcStep } from './sfc'

/**
 * DV09-064..067 SFC graph model: edges, automatic layout, structural analysis and edit operations over the existing
 * step list (sequential, selective and parallel routing). Every edit is normalized, applied, re-validated against the
 * engine's own parallel-graph rules and compacted back, so a result is always something the engine can execute.
 */
export type EdgeKind = 'sequential' | 'selective' | 'parallel'
export interface SfcEdge { from: string; to: string; kind: EdgeKind; /** Alternative index for selective edges, leg index for parallel ones. */ index: number; back: boolean }

export interface SfcNode { id: string; row: number; col: number; reachable: boolean }
export interface SfcLayout { nodes: Record<string, SfcNode>; edges: SfcEdge[]; rows: number; cols: number }

const DEFAULT_ROUTE_CONDITION: SfcCondition = { kind: 'timer', seconds: 5 }

/** Every outgoing route of the chart as an edge; a missing target (dangling id) is omitted here and reported by analysis. */
export function sfcEdges(steps: SfcStep[]): Omit<SfcEdge, 'back'>[] {
  const ids = new Set(steps.map((s) => s.id))
  const out: Omit<SfcEdge, 'back'>[] = []
  steps.forEach((step, i) => {
    if (step.parallelNextSteps?.length) {
      step.parallelNextSteps.forEach((to, index) => { if (ids.has(to)) out.push({ from: step.id, to, kind: 'parallel', index }) })
      return
    }
    const next = sequentialTarget(steps, i)
    if (next && ids.has(next)) out.push({ from: step.id, to: next, kind: 'sequential', index: 0 })
    step.alternatives?.forEach((route, index) => { if (ids.has(route.nextStep)) out.push({ from: step.id, to: route.nextStep, kind: 'selective', index }) })
  })
  return out
}

/** Layered layout: rows follow the longest forward path from the initial step, columns separate branches and legs. */
export function layoutSfc(steps: SfcStep[]): SfcLayout {
  const raw = sfcEdges(steps)
  const adj = new Map<string, string[]>()
  for (const e of raw) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to])
  const state = new Map<string, 0 | 1 | 2>()
  const post: string[] = []
  const back = new Set<string>()
  const visit = (id: string): void => {
    state.set(id, 1)
    for (const to of adj.get(id) ?? []) {
      const s = state.get(to)
      if (s === 1) back.add(`${id}>${to}`)
      else if (!s) visit(to)
    }
    state.set(id, 2)
    post.push(id)
  }
  if (steps.length) visit(steps[0].id)
  const order = [...post].reverse()
  const row: Record<string, number> = {}
  for (const id of order) row[id] = 0
  for (const id of order) for (const to of adj.get(id) ?? []) if (!back.has(`${id}>${to}`)) row[to] = Math.max(row[to], row[id] + 1)

  const col: Record<string, number> = {}
  let nextCol = 1
  if (steps.length) col[steps[0].id] = 0
  const incoming = new Map<string, string[]>()
  for (const e of raw) if (!back.has(`${e.from}>${e.to}`)) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from])
  for (const id of order) {
    const out = raw.filter((e) => e.from === id && !back.has(`${e.from}>${e.to}`)).sort((a, b) => (a.kind === 'selective' ? 1 : 0) - (b.kind === 'selective' ? 1 : 0) || a.index - b.index)
    let first = true
    for (const e of out) {
      if (col[e.to] !== undefined) continue
      if (first && e.kind !== 'selective') { col[e.to] = col[id]; first = false } else { col[e.to] = nextCol++ }
    }
  }
  // Convergence: a step reached from several branches returns to the leftmost of them.
  for (const id of order) {
    const parents = incoming.get(id) ?? []
    if (parents.length > 1) col[id] = Math.min(...parents.map((p) => col[p] ?? 0))
  }
  const nodes: Record<string, SfcNode> = {}
  let maxRow = -1
  for (const id of order) maxRow = Math.max(maxRow, row[id])
  const unreachable = steps.filter((s) => !state.has(s.id))
  unreachable.forEach((s, i) => { row[s.id] = maxRow + 1 + i; col[s.id] = 0 })
  const taken = new Set<string>()
  for (const step of steps) {
    let c = col[step.id] ?? 0
    while (taken.has(`${row[step.id]}:${c}`)) c++
    taken.add(`${row[step.id]}:${c}`)
    nodes[step.id] = { id: step.id, row: row[step.id] ?? 0, col: c, reachable: state.has(step.id) }
  }
  const edges = raw.map((e) => ({ ...e, back: back.has(`${e.from}>${e.to}`) }))
  return { nodes, edges, rows: Math.max(0, ...Object.values(nodes).map((n) => n.row + 1)), cols: Math.max(1, ...Object.values(nodes).map((n) => n.col + 1)) }
}

export interface GraphIssue { severity: 'error' | 'warning'; stepId?: string; text: string }

/** Structural findings about the chart shape (not about actions or conditions). */
export function analyzeSfcGraph(steps: SfcStep[]): GraphIssue[] {
  const issues: GraphIssue[] = []
  if (!steps.length) return issues
  const ids = new Set(steps.map((s) => s.id))
  const layout = layoutSfc(steps)
  const name = (id: string): string => steps.find((s) => s.id === id)?.name ?? id
  for (const step of steps) {
    for (const id of [...(step.nextStep ? [step.nextStep] : []), ...(step.alternatives ?? []).map((a) => a.nextStep), ...(step.parallelNextSteps ?? []), ...(step.joinFrom ?? [])])
      if (!ids.has(id)) issues.push({ severity: 'error', stepId: step.id, text: `${step.name} refers to a step that no longer exists` })
    if (!layout.nodes[step.id].reachable) issues.push({ severity: 'warning', stepId: step.id, text: `${step.name} can never be reached from the initial step` })
  }
  const structural = parallelGraphError(steps)
  if (structural) issues.push({ severity: 'error', text: structural })
  const hasEnd = steps.some((s, i) => layout.nodes[s.id].reachable && !s.parallelNextSteps?.length && sequentialTarget(steps, i) === null)
  if (!hasEnd) issues.push({ severity: 'warning', text: 'No reachable step terminates the chart; it runs until it is reset' })
  const forward = new Set(layout.edges.filter((e) => !e.back).map((e) => e.from))
  for (const s of steps) if (layout.nodes[s.id].reachable && !forward.has(s.id) && layout.edges.some((e) => e.from === s.id && e.back))
    issues.push({ severity: 'warning', stepId: s.id, text: `${name(s.id)} only loops back; the chart cannot finish from there` })
  return issues
}

// --- editing ---------------------------------------------------------------

export type EditResult = { steps: SfcStep[] } | { error: string }
const clone = (steps: SfcStep[]): SfcStep[] => steps.map((s) => ({ ...s, alternatives: s.alternatives?.map((a) => ({ ...a })), parallelNextSteps: s.parallelNextSteps && [...s.parallelNextSteps], joinFrom: s.joinFrom && [...s.joinFrom] }))
const isFork = (s: SfcStep): boolean => !!s.parallelNextSteps?.length

/** Make every sequential target explicit so array order can change freely during an edit. */
function normalize(steps: SfcStep[]): SfcStep[] {
  const out = clone(steps)
  out.forEach((s, i) => { if (!isFork(s) && s.nextStep === undefined) s.nextStep = sequentialTarget(steps, i) })
  return out
}

/** Drop explicit targets that equal the array successor so ordinary charts stay in their simple stored form. */
function compact(steps: SfcStep[]): SfcStep[] {
  return steps.map((s, i) => {
    if (isFork(s)) return s
    const implicit = steps[i + 1]?.id ?? null
    if ((s.nextStep ?? null) === implicit && !s.alternatives?.length) { const { nextStep: _drop, ...rest } = s; void _drop; return rest as SfcStep }
    if (s.alternatives?.length && s.nextStep === undefined) return { ...s, nextStep: implicit }
    return s
  })
}

function finish(steps: SfcStep[]): EditResult {
  const result = compact(steps)
  const error = parallelGraphError(result)
  return error ? { error } : { steps: result }
}

const indexOf = (steps: SfcStep[], id: string): number => steps.findIndex((s) => s.id === id)
const missing = (id: string): EditResult => ({ error: `Step ${id} does not exist` })

/** Insert a new step directly after `afterId` on its primary route. */
export function addStepAfter(steps: SfcStep[], afterId: string, name: string): EditResult {
  const work = normalize(steps)
  const i = indexOf(work, afterId)
  if (i < 0) return missing(afterId)
  const after = work[i]
  if (isFork(after)) return { error: 'A parallel divergence leads into its legs; add the step inside a leg instead' }
  const added = newStep(name)
  added.nextStep = after.nextStep ?? null
  const oldTarget = after.nextStep ?? null
  after.nextStep = added.id
  for (const s of work) if (s.joinFrom?.includes(after.id) && oldTarget === s.id) s.joinFrom = s.joinFrom.map((id) => (id === after.id ? added.id : id))
  work.splice(i + 1, 0, added)
  return finish(work)
}

/** Remove a step and reconnect everything that led to it to its primary successor. */
export function deleteStepHealing(steps: SfcStep[], id: string): EditResult {
  const work = normalize(steps)
  const i = indexOf(work, id)
  if (i < 0) return missing(id)
  const step = work[i]
  if (isFork(step) || step.joinFrom?.length) return { error: 'Remove the parallel divergence and convergence together with "Remove parallel"' }
  if (work.length === 1) return { error: 'A chart needs at least one step' }
  if (i === 0 && !step.nextStep) return { error: 'The initial step cannot be removed while nothing follows it' }
  const successor = step.nextStep ?? null
  work.splice(i, 1)
  if (i === 0 && successor) { const si = indexOf(work, successor); const [moved] = work.splice(si, 1); work.unshift(moved) }
  for (const s of work) {
    if (s.nextStep === id) s.nextStep = successor
    s.alternatives = s.alternatives?.flatMap((a) => (a.nextStep === id ? (successor ? [{ ...a, nextStep: successor }] : []) : [a]))
    if (s.alternatives && !s.alternatives.length) delete s.alternatives
    if (s.parallelNextSteps?.includes(id)) {
      if (!successor) return { error: 'The first step of a parallel leg cannot be removed without a following step' }
      s.parallelNextSteps = s.parallelNextSteps.map((p) => (p === id ? successor : p))
    }
    if (s.joinFrom?.includes(id)) {
      return { error: 'The last step of a parallel leg cannot be removed; remove the whole leg or the parallel structure' }
    }
  }
  return finish(work)
}

/** Add a selective (alternative) route from a step to an existing step. */
export function addSelectiveRoute(steps: SfcStep[], fromId: string, toId: string, condition: SfcCondition = DEFAULT_ROUTE_CONDITION): EditResult {
  const work = normalize(steps)
  const from = work.find((s) => s.id === fromId)
  if (!from) return missing(fromId)
  if (!work.some((s) => s.id === toId)) return missing(toId)
  if (isFork(from)) return { error: 'A parallel divergence cannot also have selective routes' }
  if (toId === fromId) return { error: 'A step cannot branch to itself; connect it to a different step' }
  if (from.nextStep === toId || from.alternatives?.some((a) => a.nextStep === toId)) return { error: 'That route already exists' }
  from.alternatives = [...(from.alternatives ?? []), { condition, nextStep: toId }]
  return finish(work)
}

export function removeSelectiveRoute(steps: SfcStep[], fromId: string, index: number): EditResult {
  const work = normalize(steps)
  const from = work.find((s) => s.id === fromId)
  if (!from) return missing(fromId)
  if (!from.alternatives?.[index]) return { error: 'That selective route does not exist' }
  from.alternatives = from.alternatives.filter((_, i) => i !== index)
  if (!from.alternatives.length) delete from.alternatives
  return finish(work)
}

/** Point a step's primary route at any step (a return/loop or a convergence) or at nothing (terminate). */
export function setPrimaryRoute(steps: SfcStep[], fromId: string, toId: string | null): EditResult {
  const work = normalize(steps)
  const from = work.find((s) => s.id === fromId)
  if (!from) return missing(fromId)
  if (toId !== null && !work.some((s) => s.id === toId)) return missing(toId)
  if (isFork(from)) return { error: 'A parallel divergence leads to its legs, not to one step' }
  if (from.joinFrom?.includes(toId ?? '')) return { error: 'A step cannot lead back into a join it already feeds' }
  if (work.some((s) => s.joinFrom?.length && s.id === toId && !s.joinFrom.includes(fromId))) return { error: 'A join accepts only the steps that end its parallel legs' }
  from.nextStep = toId
  return finish(work)
}

/** Turn a step into a parallel divergence with `legs` independent one-step legs and a convergence step after them. */
export function makeParallel(steps: SfcStep[], atId: string, legs = 2): EditResult {
  if (!Number.isInteger(legs) || legs < 2 || legs > 6) return { error: 'A parallel divergence needs 2 to 6 legs' }
  const work = normalize(steps)
  const i = indexOf(work, atId)
  if (i < 0) return missing(atId)
  const fork = work[i]
  if (isFork(fork) || fork.joinFrom?.length) return { error: 'That step is already part of a parallel structure' }
  if (fork.alternatives?.length) return { error: 'Remove the selective routes before making the step a parallel divergence' }
  const oldTarget = fork.nextStep ?? null
  const legSteps = Array.from({ length: legs }, (_, n) => newStep(`LEG ${n + 1}`))
  const join = newStep('JOIN')
  legSteps.forEach((l) => { l.nextStep = join.id })
  join.nextStep = oldTarget
  join.joinFrom = legSteps.map((l) => l.id)
  fork.parallelNextSteps = legSteps.map((l) => l.id)
  delete fork.nextStep
  work.splice(i + 1, 0, ...legSteps, join)
  return finish(work)
}

/** Add one more leg to the parallel divergence that starts at `forkId`. */
export function addParallelLeg(steps: SfcStep[], forkId: string): EditResult {
  const work = normalize(steps)
  const fork = work.find((s) => s.id === forkId)
  if (!fork) return missing(forkId)
  if (!isFork(fork)) return { error: 'Select a parallel divergence step' }
  if ((fork.parallelNextSteps?.length ?? 0) >= 6) return { error: 'A parallel divergence has at most 6 legs' }
  const join = work.find((s) => s.joinFrom?.length && fork.parallelNextSteps?.some((id) => reaches(work, id, s.id)))
  if (!join) return { error: 'The parallel divergence has no convergence' }
  const leg = newStep(`LEG ${(fork.parallelNextSteps?.length ?? 0) + 1}`)
  leg.nextStep = join.id
  fork.parallelNextSteps = [...(fork.parallelNextSteps ?? []), leg.id]
  join.joinFrom = [...(join.joinFrom ?? []), leg.id]
  work.splice(indexOf(work, join.id), 0, leg)
  return finish(work)
}

function reaches(steps: SfcStep[], from: string, to: string): boolean {
  const seen = new Set<string>()
  const walk = (id: string): boolean => {
    if (id === to) return true
    if (seen.has(id)) return false
    seen.add(id)
    const s = steps.find((x) => x.id === id)
    return !!s && (s.nextStep ? walk(s.nextStep) : false)
  }
  return walk(from)
}

/** Collapse a parallel structure back to one step: legs and the convergence are removed, the divergence continues. */
export function removeParallel(steps: SfcStep[], forkId: string): EditResult {
  const work = normalize(steps)
  const fork = work.find((s) => s.id === forkId)
  if (!fork) return missing(forkId)
  if (!isFork(fork)) return { error: 'Select a parallel divergence step' }
  const join = work.find((s) => s.joinFrom?.length && fork.parallelNextSteps?.some((id) => reaches(work, id, s.id)))
  if (!join) return { error: 'The parallel divergence has no convergence' }
  const doomed = new Set<string>([join.id])
  for (const id of fork.parallelNextSteps ?? []) {
    let cur: string | null = id
    while (cur && cur !== join.id && !doomed.has(cur)) { doomed.add(cur); cur = work.find((s) => s.id === cur)?.nextStep ?? null }
  }
  if (work.some((s) => !doomed.has(s.id) && s.id !== fork.id && (s.nextStep && doomed.has(s.nextStep) || s.alternatives?.some((a) => doomed.has(a.nextStep)))))
    return { error: 'Other steps route into the parallel legs; reconnect them first' }
  fork.nextStep = join.nextStep ?? null
  delete fork.parallelNextSteps
  return finish(work.filter((s) => !doomed.has(s.id)))
}
