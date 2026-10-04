import { useEffect, useRef, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { resolvePictureTarget, usePictures, type PicElement, type PicParam } from '../engine/pictureStore'
import { fmt } from '../utils/format'
import type { AnyModule } from '../engine/types'
import { ClassicTank, PALE_BORDER, PALE_TEXT } from '../components/ClassicGraphics'
import { pictureFill, pictureLimits, pictureSignal } from '../engine/pictureDynamics'
import { SimulatorDialog } from '../components/SimulatorDialog'

const PARAMS: PicParam[] = ['PV', 'SP', 'OUT', 'MODE', 'STATE']

function paramValue(m: AnyModule | undefined, param: PicParam): string {
  if (!m) return '—'
  if (param === 'PV') {
    if (m.type === 'PID' || m.type === 'AI' || m.type === 'AO') return `${fmt(m.pv, m.decimals)} ${m.unit}`
    if (m.type === 'MOTOR') return m.running ? 'RUN' : 'STOP'
    if (m.type === 'VALVE') return m.open ? 'OPEN' : 'CLOSED'
    if (m.type === 'FB') return `${fmt(m.out, 2)}`
    return m.state ? m.activeDescriptor : m.inactiveDescriptor
  }
  if (param === 'SP') return m.type === 'PID' || m.type === 'AO' ? `${fmt(m.sp, m.decimals)} ${m.unit}` : '—'
  if (param === 'OUT') return m.type === 'PID' || m.type === 'AO' ? `${fmt(m.out, 1)} %` : '—'
  if (param === 'MODE') return m.type === 'AO' ? m.actualMode : m.type === 'PID' ? m.mode : '—'
  // STATE
  if (m.type === 'MOTOR') return m.running ? 'RUNNING' : 'STOPPED'
  if (m.type === 'VALVE') return m.open ? 'OPEN' : 'CLOSED'
  if (m.type === 'DI' || m.type === 'DO') return m.state ? m.activeDescriptor : m.inactiveDescriptor
  return '—'
}

export function DisplayBuilder(): JSX.Element {
  const pictures = usePictures((s) => s.pictures)
  const createPicture = usePictures((s) => s.createPicture)
  const deletePicture = usePictures((s) => s.deletePicture)
  const addElement = usePictures((s) => s.addElement)
  const savePicture = usePictures(s => s.savePicture)
  const loadPicture = usePictures(s => s.loadPicture)
  const modules = useStore(s => s.modules)
  const names = Object.keys(pictures)
  const [selected, setSelected] = useState<string>(names[0] ?? '')
  const [edit, setEdit] = useState(true)
  const [selEl, setSelEl] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [pictureProperties, setPictureProperties] = useState(false)
  const navigate = useUi(s => s.navigate)
  const requestedPicture = useUi(s => s.builderPicture)
  const requestedRun = useUi(s => s.builderRun)
  const openPicture = useUi(s => s.openPicture)
  useEffect(() => {
    if (requestedPicture) {
      setSelected(requestedPicture)
      setSelEl(null)
      setPictureProperties(false)
    }
    setEdit(!requestedRun)
  }, [requestedPicture, requestedRun])

  const pic = pictures[selected]

  const openPictureLink = (name: string | undefined): void => {
    if (edit) {
      setPictureProperties(true)
      return
    }
    const target = resolvePictureTarget(name ?? '', pictures)
    if (!target) {
      const message = `Navigation picture not found: ${name || '(not configured)'}`
      useStore.getState().logEvent('DIAGNOSTIC', selected, message)
      window.alert(message)
      return
    }
    if (target.kind === 'display') navigate(target.display)
    else {
      openPicture(target.name)
    }
  }

  const add = (type: PicElement['type']): void => {
    if (!pic) return
    const base = { x: 40, y: 40 }
    const tag = modules['LIC-101'] ? 'LIC-101' : Object.values(modules).find(m => m.type === 'AI')?.tag ?? Object.keys(modules)[0]
    const id =
      type === 'text'
        ? addElement(selected, { type, ...base, content: 'Text', fontSize: 14 })
        : addElement(selected, { type, ...base, tag, param: 'PV', label: true,
          ...(type === 'rectangle' ? { width: 64, height: 160 } : {}) })
    setSelEl(id)
  }

  return (
    <div className="display builder">
      <div className="bld-toolbar">
        <select className="exp-alm-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <input
          className="sfc-newinput"
          style={{ maxWidth: 140 }}
          placeholder="New picture"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          className="tbtn sm"
          disabled={!newName.trim()}
          onClick={() => {
            createPicture(newName)
            setSelected(newName.trim().toUpperCase())
            setNewName('')
          }}
        >
          Create
        </button>
        <span style={{ width: 12 }} />
        <button className={'tbtn sm' + (edit ? ' active' : '')} onClick={() => setEdit((v) => !v)}>
          {edit ? '✎ Configure' : '▷ Run'}
        </button>
        {pic && (
          <>
            <button className="tbtn sm" disabled={!edit && !pic.previousPicture}
              title={pic.previousPicture || 'Previous picture is not configured'}
              onClick={() => openPictureLink(pic.previousPicture)}>Previous Picture</button>
            <button className="tbtn sm" disabled={!edit && !pic.nextPicture}
              title={pic.nextPicture || 'Next picture is not configured'}
              onClick={() => openPictureLink(pic.nextPicture)}>Next Picture</button>
          </>
        )}
        {edit && pic && (
          <>
            <button className="tbtn sm" onClick={() => savePicture(selected)}>Save Picture</button>
            <button className="tbtn sm" onClick={() => {
              if (window.confirm('Replace this picture with its saved browser configuration?')) {
                if (loadPicture(selected)) setSelEl(null)
              }
            }}>Load Saved Picture</button>
            <button className="tbtn sm" onClick={() => add('datalink')}>
              + Datalink
            </button>
            <button className="tbtn sm" onClick={() => add('text')}>
              + Text
            </button>
            <button className="tbtn sm" onClick={() => add('dynamo')}>
              + Dynamo
            </button>
            <button className="tbtn sm" onClick={() => add('tank')}>+ Tank Dynamo</button>
            <button className="tbtn sm" onClick={() => add('rectangle')}>+ Rectangle</button>
          </>
        )}
        <span style={{ flex: 1 }} />
        {pic && (
          <button className="tbtn sm danger" onClick={() => deletePicture(selected)}>
            Delete Picture
          </button>
        )}
      </div>

      <div className="bld-body">
        {!pic ? (
          <div className="exp-empty">Create a picture to begin.</div>
        ) : (
          <>
            <Canvas key={selected} picture={selected} edit={edit} selEl={selEl} setSelEl={setSelEl} />
            {edit && pictureProperties ? (
              <PictureProperties key={selected} picture={selected} onClose={() => setPictureProperties(false)} />
            ) : edit && selEl ? <PropsPanel picture={selected} id={selEl} /> : null}
          </>
        )}
      </div>
    </div>
  )
}

function PictureProperties({ picture, onClose }: { picture: string; onClose: () => void }): JSX.Element {
  const pic = usePictures(s => s.pictures[picture])
  const setPictureLinks = usePictures(s => s.setPictureLinks)
  const [previous, setPrevious] = useState(pic.previousPicture ?? '')
  const [next, setNext] = useState(pic.nextPicture ?? '')
  const [error, setError] = useState('')
  return (
    <div className="bld-props">
      <div className="bld-props-head"><b>Previous / Next Picture</b></div>
      <label className="bld-f">Previous Picture Name
        <input value={previous} onChange={e => setPrevious(e.target.value)} placeholder="Ovw_ref.grf" />
      </label>
      <label className="bld-f">Next Picture Name
        <input value={next} onChange={e => setNext(e.target.value)} placeholder="alarmList.grf" />
      </label>
      <p>Use a created picture name, Ovw_ref.grf (Overview) or alarmList.grf (Alarm List). Blank removes a link.</p>
      {error && <div className="exp-newmod-err" role="alert">{error}</div>}
      <div className="exp-newmod-actions">
        <button className="tbtn sm" onClick={() => {
          if (setPictureLinks(picture, previous, next)) onClose()
          else setError('Links were not applied. Check picture names and your Can Configure key.')
        }}>Apply Links</button>
        <button className="tbtn sm" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

function Canvas({
  picture,
  edit,
  selEl,
  setSelEl
}: {
  picture: string
  edit: boolean
  selEl: string | null
  setSelEl: (id: string | null) => void
}): JSX.Element {
  const els = usePictures((s) => s.pictures[picture]?.elements ?? [])
  const updateElement = usePictures((s) => s.updateElement)
  const modules = useStore((s) => s.modules)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const [entryId, setEntryId] = useState<string | null>(null)

  useEffect(() => {
    function onMove(e: MouseEvent): void {
      if (!drag.current) return
      updateElement(picture, drag.current.id, {
        x: Math.max(0, e.clientX - drag.current.dx),
        y: Math.max(0, e.clientY - drag.current.dy)
      })
    }
    function onUp(): void {
      drag.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [picture, updateElement])

  return (
    <div className="bld-canvas" onMouseDown={() => edit && setSelEl(null)}>
      {els.map((el) => {
        const m = el.tag ? modules[el.tag] : undefined
        const startDrag = (e: React.MouseEvent): void => {
          if (!edit) return
          e.stopPropagation()
          setSelEl(el.id)
          drag.current = { id: el.id, dx: e.clientX - el.x, dy: e.clientY - el.y }
        }
        const sel = edit && selEl === el.id
        if (el.type === 'tank') return <svg key={el.id}
          className={'bld-el' + (sel ? ' sel' : '')} width={160} height={220}
          style={{ left: el.x, top: el.y }} onMouseDown={startDrag}
          aria-label={`${el.tag ?? ''} tank dynamo`}>
          <ClassicTank x={16} y={24} w={128} h={160} level={0} label={el.tag ?? ''} />
        </svg>
        if (el.type === 'rectangle') {
          const fill = el.fill ? pictureFill(el, modules) : null
          const error = fill && 'error' in fill ? fill.error : undefined
          const percent = fill && !('error' in fill) ? fill.percent ?? 100 : 100
          const bad = !!fill && !('error' in fill) && fill.bad
          return <div key={el.id} className={'bld-el bld-rectangle' + (sel ? ' sel' : '')}
            style={{ left: el.x, top: el.y, width: el.width ?? 64, height: el.height ?? 160,
              background: el.backgroundColor ?? '#eef2f5', borderColor: PALE_BORDER, borderStyle: bad ? 'dashed' : 'solid' }}
            onMouseDown={startDrag} title={error ?? (bad ? 'Bad - held signal' : `${percent}% fill`)}
            aria-label={`${el.tag ?? ''} fill rectangle${error ? `: ${error}` : bad ? ': Bad - held signal' : ''}`}
            data-fill-percent={error ? undefined : percent}>
            {!error && <div className="bld-fill" style={{ background: el.color ?? '#5f7f94',
              width: el.fill?.vertical ? '100%' : `${percent}%`,
              height: el.fill?.vertical ? `${percent}%` : '100%' }} />}
            {(el.width ?? 64) >= 24 && (el.height ?? 160) >= 16 &&
              (error ? <span className="bld-quality" role="alert">{error}</span> :
                bad ? <span className="bld-quality">Bad</span> : null)}
          </div>
        }
        if (el.type === 'text') {
          return (
            <div
              key={el.id}
              className={'bld-el bld-text' + (sel ? ' sel' : '')}
              style={{ left: el.x, top: el.y, fontSize: el.fontSize, fontWeight: el.bold ? 800 : 500, color: el.color }}
              onMouseDown={startDrag}
            >
              {el.content}
            </div>
          )
        }
        if (el.type === 'dynamo') {
          return (
            <div
              key={el.id}
              className={'bld-el valbox' + (sel ? ' sel' : '')}
              style={{ left: el.x, top: el.y, position: 'absolute' }}
              onMouseDown={startDrag}
              onClick={(e) => {
                e.stopPropagation()
                if (!edit && el.tag) openFaceplate(el.tag)
              }}
            >
              <span className="vb-tag">{el.tag}</span>
              <span className="vb-val">{paramValue(m, 'PV')}</span>
            </div>
          )
        }
        const signal = el.path || el.entry ? pictureSignal(el, modules) : null
        const value = signal ? 'error' in signal ? signal.error : `${fmt(signal.value, 2)} ${signal.unit}${signal.bad ? ' (Bad)' : ''}` :
          paramValue(m, el.param ?? 'PV')
        return (
          <div
            key={el.id}
            className={'bld-el bld-datalink' + (sel ? ' sel' : '')}
            style={{ left: el.x, top: el.y }}
            onMouseDown={startDrag}
          >
            {el.label && (
              <span className="bld-dl-label">
                {el.tag}/{el.path ?? el.param}
              </span>
            )}
            {el.entry && !edit ? <button className="bld-entry-value" aria-label={`Enter ${el.tag}/${el.path ?? el.param}`}
              style={{ color: el.color }} onClick={() => setEntryId(el.id)}>{value}</button> :
              <span className="bld-dl-val" style={{ color: el.color }}>{value}</span>}
          </div>
        )
      })}
      {els.length === 0 && <div className="exp-empty">Empty picture. Add datalinks, text, or dynamos.</div>}
      {!edit && entryId && <NumericEntryDialog picture={picture} id={entryId} onClose={() => setEntryId(null)} />}
    </div>
  )
}

function PropsPanel({ picture, id }: { picture: string; id: string }): JSX.Element | null {
  const el = usePictures((s) => s.pictures[picture]?.elements.find((e) => e.id === id))
  const updateElement = usePictures((s) => s.updateElement)
  const removeElement = usePictures((s) => s.removeElement)
  const modules = useStore((s) => s.modules)
  const tags = Object.keys(modules)
  if (!el) return null

  return (
    <div className="bld-props">
      <div className="bld-props-head">
        <b>{el.type.toUpperCase()}</b>
        <button className="tbtn sm danger" onClick={() => removeElement(picture, id)}>
          Remove
        </button>
      </div>
      {el.type === 'text' ? (
        <>
          <label className="bld-f">
            Content
            <input value={el.content ?? ''} onChange={(e) => updateElement(picture, id, { content: e.target.value })} />
          </label>
          <label className="bld-f">
            Font size
            <input
              type="number"
              value={el.fontSize ?? 14}
              onChange={(e) => updateElement(picture, id, { fontSize: Number(e.target.value) })}
            />
          </label>
          <label className="bld-f bld-f-row">
            <input
              type="checkbox"
              checked={!!el.bold}
              onChange={(e) => updateElement(picture, id, { bold: e.target.checked })}
            />
            Bold
          </label>
        </>
      ) : (
        <>
          <label className="bld-f">
            Module tag
            <select value={el.tag} onChange={(e) => updateElement(picture, id, { tag: e.target.value })}>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {el.type === 'datalink' && (
            <>
              <label className="bld-f">
                Parameter
                <select value={el.param} onChange={(e) => updateElement(picture, id, { param: e.target.value as PicParam })}>
                  {PARAMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="bld-f bld-f-row">
                <input
                  type="checkbox"
                  checked={!!el.label}
                  onChange={(e) => updateElement(picture, id, { label: e.target.checked })}
                />
                Show label
              </label>
            </>
          )}
          {(el.type === 'datalink' || el.type === 'rectangle') &&
            <DynamicsExpert key={`${id}-${el.tag}`} picture={picture} element={el} />}
        </>
      )}
      <div className="bld-f bld-f-row">
        <span>X</span>
        <input type="number" value={Math.round(el.x)} onChange={(e) => updateElement(picture, id, { x: Number(e.target.value) })} />
        <span>Y</span>
        <input type="number" value={Math.round(el.y)} onChange={(e) => updateElement(picture, id, { y: Number(e.target.value) })} />
      </div>
    </div>
  )
}

function DynamicsExpert({ picture, element: el }: { picture: string; element: PicElement }): JSX.Element {
  const configure = usePictures(s => s.configureDynamics)
  const [path, setPath] = useState(el.path ?? el.param ?? 'PV')
  const [enabled, setEnabled] = useState(!!(el.entry || el.fill))
  const settings = el.entry ?? el.fill
  const [fetchLimits, setFetchLimits] = useState(settings?.fetchLimits ?? el.type === 'rectangle')
  const [low, setLow] = useState(String(settings?.low ?? 0))
  const [high, setHigh] = useState(String(settings?.high ?? 1000))
  const [vertical, setVertical] = useState(el.fill?.vertical ?? true)
  const [width, setWidth] = useState(String(el.width ?? 64))
  const [height, setHeight] = useState(String(el.height ?? 160))
  const [color, setColor] = useState(el.color ?? (el.type === 'rectangle' ? '#5f7f94' : PALE_TEXT))
  const [background, setBackground] = useState(el.backgroundColor ?? '#eef2f5')
  const numeric = (value: string): number => value.trim() ? Number(value) : NaN
  const rectangle = el.type === 'rectangle'
  return <>
    <div className="bld-props-head"><b>{rectangle ? 'Fill Animation Expert' : 'Data Entry Expert'}</b></div>
    <label className="bld-f">Source Path
      <input aria-label="Picture source path" value={path} onChange={e => setPath(e.target.value)} />
    </label>
    <label className="bld-f bld-f-row"><input type="checkbox" checked={enabled}
      onChange={e => setEnabled(e.target.checked)} />{rectangle ? 'Fill Percentage' : 'Numeric Entry'}</label>
    {rectangle && <label className="bld-f bld-f-row"><input type="checkbox" checked={vertical}
      onChange={e => setVertical(e.target.checked)} />Vertical Direction</label>}
    <label className="bld-f bld-f-row"><input type="checkbox" checked={fetchLimits}
      onChange={e => setFetchLimits(e.target.checked)} />Fetch Limits from Data Source</label>
    <label className="bld-f">Low Limit<input type="number" step="any" disabled={fetchLimits}
      value={low} onChange={e => setLow(e.target.value)} /></label>
    <label className="bld-f">High Limit<input type="number" step="any" disabled={fetchLimits}
      value={high} onChange={e => setHigh(e.target.value)} /></label>
    {rectangle && <>
      <label className="bld-f">Width<input type="number" value={width} onChange={e => setWidth(e.target.value)} /></label>
      <label className="bld-f">Height<input type="number" value={height} onChange={e => setHeight(e.target.value)} /></label>
      <label className="bld-f">Background<input type="color" value={background} onChange={e => setBackground(e.target.value)} /></label>
    </>}
    <label className="bld-f">Foreground<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
    <button className="tbtn sm" onClick={() => {
      const limits = { fetchLimits, low: numeric(low), high: numeric(high) }
      configure(picture, el.id, { path, color, ...(rectangle ? {
        width: numeric(width), height: numeric(height), backgroundColor: background,
        fill: enabled ? { ...limits, vertical } : undefined
      } : { entry: enabled ? { ...limits, method: 'NUMERIC' } : undefined }) })
    }}>Apply Expert</button>
    <p>AO Floating Point entry supports explicit bounds. AI/PID/AO PV fills use the current engineering scale when limits are fetched.</p>
  </>
}

function NumericEntryDialog({ picture, id, onClose }: { picture: string; id: string; onClose: () => void }): JSX.Element {
  const el = usePictures(s => s.pictures[picture]?.elements.find(e => e.id === id))
  const modules = useStore(s => s.modules)
  const write = usePictures(s => s.writeNumericValue)
  const source = el ? pictureSignal(el, modules) : { error: 'Datalink removed' }
  const limits = el?.entry && !('error' in source) ? pictureLimits(el.entry, source) : undefined
  const [value, setValue] = useState('error' in source ? '' : String(source.value))
  return <SimulatorDialog className="bld-entry-dialog" label="Numeric Data Entry" onClose={onClose}>
    <form noValidate onSubmit={e => {
      e.preventDefault()
      if (write(picture, id, value.trim() ? Number(value) : NaN)) onClose()
    }}>
      <b>{el?.tag}/{el?.path ?? el?.param}</b>
      <p>{limits ? 'error' in limits ? limits.error : `Allowed: ${limits.low} to ${limits.high}` : 'No valid limits'}</p>
      <label>Numeric Value <input aria-label="Numeric Value" type="number" step="any"
        min={limits && !('error' in limits) ? limits.low : undefined}
        max={limits && !('error' in limits) ? limits.high : undefined} value={value}
        onChange={e => setValue(e.target.value)} /></label>
      <div className="traditional-channel-form">
        <button className="tbtn sm" type="submit">Apply Value</button>
        <button className="tbtn sm" type="button" onClick={onClose}>Cancel Entry</button>
      </div>
    </form>
  </SimulatorDialog>
}
