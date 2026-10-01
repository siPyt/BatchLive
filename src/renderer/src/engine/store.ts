import { create } from 'zustand'
import type {
  PlantState,
  ControlMode,
  PidModule,
  MotorModule,
  ValveModule,
  DiscreteOutput,
  TrendPoint,
  AnyModule
} from './types'
import { buildInitialPlant } from './plant'
import { stepPlant } from './simulate'

const TREND_SECONDS = 600 // 10 minutes of history
const TREND_HZ = 2

interface StoreState extends PlantState {
  trend: TrendPoint[]
  rev: number
  // operator actions
  setMode: (tag: string, mode: ControlMode) => void
  setSetpoint: (tag: string, sp: number) => void
  setOutput: (tag: string, out: number) => void
  setTuning: (tag: string, t: { gain?: number; reset?: number; rate?: number }) => void
  startMotor: (tag: string) => void
  stopMotor: (tag: string) => void
  openValve: (tag: string) => void
  closeValve: (tag: string) => void
  toggleDO: (tag: string) => void
  toggleInterlock: (tag: string) => void
  injectFault: (tag: string) => void
  ackAlarm: (id: string) => void
  ackAll: () => void
  setRunning: (r: boolean) => void
  setSpeed: (s: number) => void
  tick: (dt: number) => void
}

const initial = buildInitialPlant()

export const useStore = create<StoreState>((set, get) => ({
  ...initial,
  trend: [],
  rev: 0,

  tick: (dt: number) => {
    const s = get()
    if (!s.running) return
    const next = stepPlant(s, dt)
    // Sample trend data.
    const trend = s.trend
    const last = trend[trend.length - 1]
    const shouldSample = !last || next.time - last.t >= 1000 / TREND_HZ
    let newTrend = trend
    if (shouldSample) {
      const point: TrendPoint = {
        t: next.time,
        values: {
          'FIC-101.PV': next.process.feedFlow,
          'FIC-101.SP': (next.modules['FIC-101'] as PidModule).sp,
          'LIC-101.PV': next.process.feedTankLevel,
          'LIC-101.SP': (next.modules['LIC-101'] as PidModule).sp,
          'LIC-201.PV': next.process.reactorLevel,
          'LIC-201.SP': (next.modules['LIC-201'] as PidModule).sp,
          'TIC-201.PV': next.process.reactorTemp,
          'TIC-201.SP': (next.modules['TIC-201'] as PidModule).sp,
          'PIC-301.PV': next.process.headerPressure,
          'PIC-301.SP': (next.modules['PIC-301'] as PidModule).sp,
          'AT-301.PV': next.process.reactorConc
        }
      }
      const cutoff = next.time - TREND_SECONDS * 1000
      newTrend = [...trend, point].filter((p) => p.t >= cutoff)
    }
    set({ ...next, trend: newTrend, rev: s.rev + 1 })
  },

  setMode: (tag, mode) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        p.mode = mode
        if (mode === 'MAN') p._integral = p.out
      }
    }),

  setSetpoint: (tag, sp) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        p.sp = Math.max(p.pvMin, Math.min(p.pvMax, sp))
      }
    }),

  setOutput: (tag, out) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        if (p.mode === 'MAN' || p.mode === 'ROUT') p.out = Math.max(0, Math.min(100, out))
      }
    }),

  setTuning: (tag, t) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'PID') {
        const p = m as PidModule
        if (t.gain !== undefined) p.gain = t.gain
        if (t.reset !== undefined) p.reset = t.reset
        if (t.rate !== undefined) p.rate = t.rate
      }
    }),

  startMotor: (tag) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).commanded = true
    }),

  stopMotor: (tag) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).commanded = false
    }),

  openValve: (tag) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'VALVE') (m as ValveModule).commandedOpen = true
    }),

  closeValve: (tag) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'VALVE') (m as ValveModule).commandedOpen = false
    }),

  toggleDO: (tag) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'DO') {
        const d = m as DiscreteOutput
        d.commanded = !d.commanded
        d.state = d.commanded
      }
    }),

  toggleInterlock: (tag) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).interlock = !(m as MotorModule).interlock
      if (m.type === 'VALVE') (m as ValveModule).interlock = !(m as ValveModule).interlock
    }),

  injectFault: (tag) =>
    mutateModule(set, get, tag, (m) => {
      if (m.type === 'MOTOR') (m as MotorModule).fault = !(m as MotorModule).fault
      if (m.type === 'VALVE') (m as ValveModule).fault = !(m as ValveModule).fault
    }),

  ackAlarm: (id) =>
    set((s) => ({
      alarms: s.alarms
        .map((a) => (a.id === id ? { ...a, acknowledged: true } : a))
        .filter((a) => a.active || !a.acknowledged),
      rev: s.rev + 1
    })),

  ackAll: () =>
    set((s) => ({
      alarms: s.alarms.map((a) => ({ ...a, acknowledged: true })).filter((a) => a.active),
      rev: s.rev + 1
    })),

  setRunning: (r) => set({ running: r }),
  setSpeed: (speed) => set({ speed })
}))

function mutateModule(
  set: (fn: (s: StoreState) => Partial<StoreState>) => void,
  get: () => StoreState,
  tag: string,
  fn: (m: AnyModule) => void
): void {
  const s = get()
  const existing = s.modules[tag]
  if (!existing) return
  const clone = { ...existing } as AnyModule
  fn(clone)
  set((st) => ({ modules: { ...st.modules, [tag]: clone }, rev: st.rev + 1 }))
}
