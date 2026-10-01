import { useStore } from '../engine/store'
import { useUi, type DisplayId } from '../ui/uiStore'

interface NavNode {
  id: DisplayId
  label: string
  ico: string
}

const DISPLAYS: NavNode[] = [
  { id: 'overview', label: 'Plant Overview', ico: '▣' },
  { id: 'feed', label: 'Feed System', ico: '◉' },
  { id: 'reactor', label: 'Reactor', ico: '⬡' },
  { id: 'product', label: 'Product / Header', ico: '◈' }
]

const TOOLS: NavNode[] = [
  { id: 'trend', label: 'Trends', ico: '📈' },
  { id: 'alarms', label: 'Alarm List', ico: '🔔' }
]

export function NavSidebar(): JSX.Element {
  const display = useUi((s) => s.display)
  const navigate = useUi((s) => s.navigate)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const modules = useStore((s) => s.modules)

  const favorites = ['LIC-101', 'TIC-201', 'P-101', 'PIC-301']

  return (
    <div className="nav-sidebar">
      <div className="nav-section">Displays</div>
      {DISPLAYS.map((n) => (
        <div
          key={n.id}
          className={'nav-item' + (display === n.id ? ' active' : '')}
          onClick={() => navigate(n.id)}
        >
          <span className="ico">{n.ico}</span>
          {n.label}
        </div>
      ))}

      <div className="nav-section">Tools</div>
      {TOOLS.map((n) => (
        <div
          key={n.id}
          className={'nav-item' + (display === n.id ? ' active' : '')}
          onClick={() => navigate(n.id)}
        >
          <span className="ico">{n.ico}</span>
          {n.label}
        </div>
      ))}

      <div className="shelf">
        <div className="nav-section" style={{ paddingLeft: 0 }}>
          Shelf · Favorites
        </div>
        {favorites.map((tag) => {
          const m = modules[tag]
          return (
            <div key={tag} className="shelf-item" onClick={() => openFaceplate(tag)}>
              <span className="ico">★</span>
              <b>{tag}</b>
              <span style={{ color: 'var(--dv-text-mute)', fontSize: 11 }}>
                {m?.description}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
