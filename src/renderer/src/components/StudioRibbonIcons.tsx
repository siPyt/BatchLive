import type { ReactNode } from 'react'

export type GlyphName =
  | 'paste' | 'cut' | 'copy' | 'download' | 'assign' | 'collection' | 'recorder' | 'properties'
  | 'moduleParameter' | 'custom' | 'textBox' | 'stateItem'
  | 'alarm' | 'alarmGroups' | 'alarmGroupRefs'
  | 'editObject' | 'drillDown' | 'backOut' | 'onlineDebug' | 'edit'
  | 'configure' | 'namedSet' | 'tune' | 'predict' | 'neural'
  | 'checkOut' | 'checkIn' | 'undoCheckOut' | 'history'
  | 'save' | 'undo' | 'redo' | 'hierarchy' | 'parameters' | 'palette' | 'explain' | 'functionBlock' | 'logic'
  | 'zoomIn' | 'zoomOut' | 'reset' | 'new' | 'generic'

const INK = '#4b5b73'
const BLUE = '#2f6db5'
const GOLD = '#d9a21b'
const GREEN = '#3f9a4a'
const RED = '#c0392b'
const PAPER = '#ffffff'
const GRAY = '#9aa6b5'

const sheet = (x: number, y: number, w = 14, h = 18): ReactNode =>
  <g><rect x={x} y={y} width={w} height={h} fill={PAPER} stroke={INK} strokeWidth={1.3} />
    <path d={`M${x + 3},${y + 5} H${x + w - 3} M${x + 3},${y + 9} H${x + w - 3} M${x + 3},${y + 13} H${x + w - 6}`} stroke={GRAY} strokeWidth={1} /></g>
const bell = (x: number, y: number, s = 1): ReactNode =>
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <path d="M3,18 V11 A8,8 0 0 1 19,11 V18 Z M0,18 H22 M8,21 H14" fill={GOLD} stroke="#8a6a12" strokeWidth={1.3} strokeLinejoin="round" /></g>
const circles = (x: number, y: number): ReactNode =>
  <g><circle cx={x} cy={y} r={5} fill={RED} stroke="#7a2118" strokeWidth={1} />
    <circle cx={x + 7} cy={y + 2} r={5} fill={GREEN} stroke="#25602d" strokeWidth={1} />
    <circle cx={x + 3} cy={y + 8} r={5} fill={BLUE} stroke="#1a416f" strokeWidth={1} /></g>
const bars = (): ReactNode =>
  <g fill="#3a3f46" stroke="#1c1f23" strokeWidth={1}>
    <rect x={5} y={6} width={4} height={20} /><rect x={11} y={4} width={4} height={22} /><rect x={17} y={8} width={4} height={18} />
    <rect x={23} y={5} width={4} height={21} /></g>
const blocks = (): ReactNode =>
  <g fill={PAPER} stroke={INK} strokeWidth={1.3}>
    <rect x={3} y={4} width={9} height={7} /><rect x={20} y={4} width={9} height={7} /><rect x={11} y={21} width={10} height={7} />
    <path d="M7.5,11 V16 H24.5 V11 M16,16 V21" fill="none" /></g>

const GLYPHS: Record<GlyphName, ReactNode> = {
  paste: <g>{sheet(9, 8, 16, 20)}<rect x={11} y={3} width={12} height={6} fill="#c9a66b" stroke="#7a5c26" strokeWidth={1.2} /></g>,
  cut: <g stroke={INK} strokeWidth={1.6} fill="none"><path d="M10,4 L22,22 M22,4 L10,22" /><circle cx={9} cy={25} r={3.5} fill={PAPER} /><circle cx={23} cy={25} r={3.5} fill={PAPER} /></g>,
  copy: <g>{sheet(5, 4, 14, 18)}{sheet(13, 11, 14, 18)}</g>,
  download: <g><path d="M12,3 H20 V14 H26 L16,25 L6,14 H12 Z" fill="#7fa7d8" stroke={INK} strokeWidth={1.3} strokeLinejoin="round" /><path d="M5,28 H27" stroke={INK} strokeWidth={2} /></g>,
  assign: <g>{circles(9, 8)}<path d="M18,22 H28 M24,18 L28,22 L24,26" fill="none" stroke={BLUE} strokeWidth={2} /></g>,
  collection: <g><circle cx={13} cy={14} r={9} fill={PAPER} stroke={INK} strokeWidth={1.3} /><path d="M13,8 V14 L18,17" fill="none" stroke={INK} strokeWidth={1.4} />
    <path d="M20,28 V22 M24,28 V19 M28,28 V24" stroke={BLUE} strokeWidth={3} /></g>,
  recorder: <g><rect x={3} y={5} width={26} height={22} fill={PAPER} stroke={INK} strokeWidth={1.3} /><path d="M6,22 L11,14 L16,18 L25,9" fill="none" stroke={BLUE} strokeWidth={1.6} /><circle cx={25} cy={9} r={2.4} fill={RED} /></g>,
  properties: <g>{sheet(6, 3, 18, 24)}<path d="M10,20 L14,24 L22,14" fill="none" stroke={GREEN} strokeWidth={2.2} /></g>,
  moduleParameter: <g>{sheet(12, 3, 16, 22)}{circles(9, 17)}</g>,
  custom: <g fill={PAPER} stroke={INK} strokeWidth={1.3}><rect x={4} y={5} width={10} height={9} /><rect x={18} y={5} width={10} height={9} /><rect x={4} y={18} width={10} height={9} /><rect x={18} y={18} width={10} height={9} fill="#cfe0f5" /></g>,
  textBox: <g><rect x={4} y={5} width={24} height={22} fill={PAPER} stroke={INK} strokeWidth={1.3} /><path d="M10,22 L16,9 L22,22 M12.5,18 H19.5" fill="none" stroke={INK} strokeWidth={1.8} /></g>,
  stateItem: <g><path d="M16,3 L27,11 L16,19 L5,11 Z" fill="#8fd09a" stroke="#25602d" strokeWidth={1.3} /><path d="M16,13 L27,21 L16,29 L5,21 Z" fill="#7fa7d8" stroke="#1a416f" strokeWidth={1.3} /></g>,
  alarm: <g>{bell(5, 6, 1.1)}<path d="M22,2 V9 M19,6 L22,10 L25,6" fill="none" stroke={BLUE} strokeWidth={2} /></g>,
  alarmGroups: <g>{bell(1, 9, 0.95)}{bell(11, 4, 1.05)}</g>,
  alarmGroupRefs: <g>{bell(1, 10, 0.9)}{bell(10, 5, 1)}<rect x={20} y={20} width={9} height={9} fill={PAPER} stroke={INK} strokeWidth={1.2} /><path d="M22,27 L27,22 M23,22 H27 V26" fill="none" stroke={BLUE} strokeWidth={1.4} /></g>,
  editObject: <g>{sheet(4, 4, 18, 22)}{circles(10, 12)}<path d="M18,28 L28,14 L31,17 L21,30 H18 Z" fill="#e6b84b" stroke="#7a5c26" strokeWidth={1.2} /></g>,
  drillDown: <g>{blocks()}<path d="M16,24 V30 M13,27 L16,30 L19,27" stroke={BLUE} strokeWidth={1.8} fill="none" /></g>,
  backOut: <g>{blocks()}<path d="M16,31 V25 M13,28 L16,25 L19,28" stroke={BLUE} strokeWidth={1.8} fill="none" /></g>,
  onlineDebug: <g>{bars()}<path d="M24,2 L16,15 H22 L18,28 L29,12 H23 Z" fill="#f2c230" stroke="#8a6a12" strokeWidth={1.2} /></g>,
  edit: <g>{bars()}<path d="M17,28 L28,12 L31,15 L21,30 H17 Z" fill="#e8734a" stroke="#7a2e18" strokeWidth={1.2} /></g>,
  configure: <g>{sheet(4, 5, 16, 20)}<circle cx={23} cy={21} r={5} fill="#c9d3df" stroke={INK} strokeWidth={1.3} /><circle cx={23} cy={21} r={1.8} fill={PAPER} stroke={INK} /></g>,
  namedSet: <g><circle cx={11} cy={12} r={6} fill="#f5e6a8" stroke="#8a6a12" strokeWidth={1.3} /><path d="M16,16 L28,28 M23,23 L26,20 M26,26 L29,23" fill="none" stroke="#8a6a12" strokeWidth={2} /></g>,
  tune: <g><circle cx={13} cy={9} r={5} fill="#e7c9a5" stroke="#6e5230" strokeWidth={1.2} /><path d="M5,28 V21 A8,8 0 0 1 21,21 V28 Z" fill="#6b7a8c" stroke="#33404f" strokeWidth={1.2} /><path d="M22,6 V18 M19,10 H25" stroke={BLUE} strokeWidth={2} /></g>,
  predict: <g><circle cx={13} cy={9} r={5} fill="#e7c9a5" stroke="#6e5230" strokeWidth={1.2} /><path d="M5,28 V21 A8,8 0 0 1 21,21 V28 Z" fill="#8c6b7a" stroke="#4f333f" strokeWidth={1.2} /><path d="M20,24 L24,18 L28,21 L31,12" fill="none" stroke={GREEN} strokeWidth={1.8} /></g>,
  neural: <g><circle cx={13} cy={9} r={5} fill="#e7c9a5" stroke="#6e5230" strokeWidth={1.2} /><path d="M5,28 V21 A8,8 0 0 1 21,21 V28 Z" fill="#6b8c7a" stroke="#334f3f" strokeWidth={1.2} />
    <g fill={PAPER} stroke={INK} strokeWidth={1}><circle cx={24} cy={8} r={2.4} /><circle cx={28} cy={16} r={2.4} /><circle cx={22} cy={18} r={2.4} /></g></g>,
  checkOut: <g>{circles(8, 8)}<path d="M18,24 H28 M24,20 L28,24 L24,28" fill="none" stroke={GREEN} strokeWidth={2} /></g>,
  checkIn: <g>{circles(8, 8)}<path d="M28,24 H18 M22,20 L18,24 L22,28" fill="none" stroke={BLUE} strokeWidth={2} /></g>,
  undoCheckOut: <g>{circles(8, 8)}<path d="M19,22 A6,6 0 1 1 25,28 M19,22 V28 H25" fill="none" stroke={RED} strokeWidth={1.8} /></g>,
  history: <g><rect x={3} y={4} width={26} height={24} fill={PAPER} stroke={INK} strokeWidth={1.3} /><path d="M6,22 L11,14 L16,18 L25,8" fill="none" stroke={BLUE} strokeWidth={1.6} /></g>,
  save: <g><path d="M4,4 H24 L28,8 V28 H4 Z" fill="#6f8fc2" stroke="#2c4470" strokeWidth={1.3} /><rect x={9} y={4} width={13} height={9} fill={PAPER} stroke="#2c4470" /><rect x={9} y={18} width={14} height={10} fill="#dbe4f2" stroke="#2c4470" /></g>,
  undo: <g><path d="M10,12 H21 A6,6 0 0 1 21,24 H12" fill="none" stroke={INK} strokeWidth={2.4} /><path d="M14,6 L8,12 L14,18" fill="none" stroke={INK} strokeWidth={2.4} /></g>,
  redo: <g><path d="M22,12 H11 A6,6 0 0 0 11,24 H20" fill="none" stroke={INK} strokeWidth={2.4} /><path d="M18,6 L24,12 L18,18" fill="none" stroke={INK} strokeWidth={2.4} /></g>,
  hierarchy: <g fill={PAPER} stroke={INK} strokeWidth={1.3}><rect x={11} y={3} width={10} height={7} /><rect x={3} y={21} width={10} height={7} /><rect x={19} y={21} width={10} height={7} /><path d="M16,10 V15 M8,21 V15 H24 V21" fill="none" /></g>,
  parameters: <g>{sheet(5, 3, 22, 26)}</g>,
  palette: <g><rect x={4} y={4} width={24} height={24} fill={PAPER} stroke={INK} strokeWidth={1.3} /><rect x={8} y={8} width={7} height={7} fill="#7fa7d8" /><rect x={17} y={8} width={7} height={7} fill="#8fd09a" /><rect x={8} y={17} width={7} height={7} fill="#f2c230" /><rect x={17} y={17} width={7} height={7} fill="#e8734a" /></g>,
  explain: <g>{sheet(5, 3, 22, 26)}<circle cx={16} cy={16} r={5} fill="#eef4fb" stroke={BLUE} strokeWidth={1.3} /><path d="M16,14 V19 M16,12 V12.5" stroke={BLUE} strokeWidth={1.8} /></g>,
  functionBlock: <g>{blocks()}</g>,
  logic: <g>{circles(9, 6)}{blocks()}</g>,
  zoomIn: <g><circle cx={13} cy={13} r={9} fill="#eef1f5" stroke="#63748b" strokeWidth={1.5} /><path d="M20,20 L29,29 M8,13 H18 M13,8 V18" stroke="#63748b" strokeWidth={1.8} fill="none" /></g>,
  zoomOut: <g><circle cx={13} cy={13} r={9} fill="#eef1f5" stroke="#63748b" strokeWidth={1.5} /><path d="M20,20 L29,29 M8,13 H18" stroke="#63748b" strokeWidth={1.8} fill="none" /></g>,
  reset: <g><path d="M5,11 A11,11 0 1 1 5,22 M5,3 V11 H13" fill="none" stroke="#63748b" strokeWidth={1.8} /></g>,
  new: <g>{sheet(6, 3, 18, 24)}<path d="M24,22 V30 M20,26 H28" stroke={GREEN} strokeWidth={2.4} /></g>,
  generic: <g>{sheet(7, 5, 18, 22)}</g>
}

export function RibbonGlyph({ name, size }: { name: GlyphName; size: number }): JSX.Element {
  return <svg className="rb-glyph" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">{GLYPHS[name]}</svg>
}
