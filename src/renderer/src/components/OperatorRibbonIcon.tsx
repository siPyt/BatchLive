export type RibbonIconKind = 'search' | 'diagnostics' | 'tools' | 'reset' | 'alarm' |
  'explorer' | 'batch' | 'trend' | 'builder' | 'user' | 'security' | 'hardware' |
  'eye' | 'display' | 'info' | 'sfc' | 'help' | 'back' | 'forward' | 'up' | 'home'

export function OperatorRibbonIcon({ kind }: { kind: RibbonIconKind }): JSX.Element {
  const blue = '#294f68'
  return (
    <svg className="operator-ribbon-icon" viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke={blue} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
      {kind === 'search' && <><circle cx="13" cy="12" r="8" /><path d="M7 19 2 26" strokeWidth="4" /></>}
      {kind === 'diagnostics' && <><path d="M16 28C-6 15 6 2 16 11 26 2 38 15 16 28Z" fill="#e9e4ba" /><path d="M5 17h5l3-6 4 13 3-8h7" /><circle cx="26" cy="5" r="4" fill="#c68343" stroke="none" /></>}
      {kind === 'tools' && <><path d="m4 4 22 22M3 3l6 2 2 5-4 2-4-4Zm22 0-5 5 4 4 5-5c2 6-3 11-8 9L8 30 3 25 16 12C14 6 19 1 25 3Z" fill="#7290a4" /></>}
      {kind === 'reset' && <><path d="M25 10a11 11 0 1 1-10-5" strokeWidth="4" /><path d="m18 2-5 3 5 5" fill={blue} /></>}
      {(kind === 'alarm' || kind === 'explorer' || kind === 'batch') && <><rect x="3" y="3" width="26" height="26" fill="#edf0e7" /><path d="M3 8h26M8 8v21" stroke="#8c9292" />{kind === 'alarm' ? <><path d="M12 22v-7a6 6 0 0 1 12 0v7l3 3H9Z" fill="#d8c26d" /><path d="M16 28h4" /></> : kind === 'explorer' ? <><path d="M13 12h11M13 17h11M13 22h11" /><circle cx="9" cy="14" r="6" fill="#e5ebeb" /><path d="m5 19-3 5" /></> : <><path d="M14 12h11v9H14zM11 25h15" fill="#6e8794" /><path d="m22 18 7 7" /></>}</>}
      {kind === 'trend' && <><rect x="2" y="3" width="28" height="26" fill="#eef0e8" /><path d="M6 6v18h21M7 19l5-7 5 4 10-9M7 23l5-3 5 1 10-6" /><path d="M4 28h25" stroke="#b9af65" /></>}
      {kind === 'builder' && <><rect x="3" y="5" width="21" height="20" fill="#e6e7df" /><path d="m14 25 13-17 3 3-13 17Z" fill="#a9b8bf" /><path d="M7 10h7v5H7z" /></>}
      {kind === 'user' && <><circle cx="13" cy="9" r="6" fill="#b4b4a5" /><path d="M3 27v-5a10 10 0 0 1 20 0v5Z" fill="#a1a999" /><circle cx="25" cy="24" r="5" fill="#e9ece4" /><path d="M25 21v6m-3-3h6" /></>}
      {kind === 'security' && <><path d="M6 3h20v11c0 7-4 12-10 15C10 26 6 21 6 14Z" fill="#d8c763" /><path d="m9 21 14-14M9 8l3 3m7 10 3 3" stroke="#438550" strokeWidth="4" /></>}
      {kind === 'hardware' && <><rect x="2" y="3" width="28" height="22" fill="#34484b" /><path d="M6 19v-7m5 7V8m5 11v-4m5 4V7m5 12v-8" stroke="#75bd64" /><path d="M11 29h10m-5-4v4" /></>}
      {kind === 'eye' && <><path d="M2 16c8-13 20-13 28 0-8 13-20 13-28 0Z" fill="#e9e9ce" /><circle cx="16" cy="16" r="6" fill="#4775a0" /><circle cx="16" cy="16" r="2" fill="#eee" stroke="none" /></>}
      {kind === 'display' && <><path d="m16 2 14 14-14 14L2 16Z" fill="#47798e" /><path d="M7 16h17m-6-6 6 6-6 6" stroke="#eee9c8" strokeWidth="3" /></>}
      {kind === 'info' && <><path d="m16 2 14 14-14 14L2 16Z" fill="#a1a68f" /><text x="16" y="24" textAnchor="middle" fontSize="24" fontFamily="Georgia, serif" fill="#f1edcc" stroke="none">I</text></>}
      {kind === 'sfc' && <><circle cx="16" cy="16" r="14" fill="#e0dfc7" /><text x="16" y="25" textAnchor="middle" fontSize="26" fontFamily="Georgia, serif" fontStyle="italic" fill="#394b50" stroke="none">S</text></>}
      {kind === 'help' && <><rect x="2" y="19" width="10" height="10" fill="#6181a3" /><rect x="20" y="19" width="10" height="10" fill="#558d58" /><text x="16" y="24" textAnchor="middle" fontSize="30" fontWeight="bold" fill="#bb9b35" stroke="none">?</text></>}
      {kind === 'back' && <path d="M28 16H5m10-11L4 16l11 11" strokeWidth="4" />}
      {kind === 'forward' && <path d="M4 16h23M17 5l11 11-11 11" strokeWidth="4" />}
      {kind === 'up' && <path d="M16 28V5M5 15 16 4l11 11" strokeWidth="4" />}
      {kind === 'home' && <path d="m2 14 14-12 14 12h-5v15h-7V19h-4v10H7V14Z" fill={blue} stroke="none" />}
    </svg>
  )
}
