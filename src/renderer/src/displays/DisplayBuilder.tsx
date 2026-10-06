import { useDatabaseClient } from '../components/useDatabaseClient'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { resolvePictureTarget, usePictures, type PicElement, type PicParam } from '../engine/pictureStore'
import { fmt } from '../utils/format'
import type { AnyModule } from '../engine/types'
import { ClassicTank, ClassicPump, ClassicControlValve, ClassicSanitaryValve,
  PALE_BORDER, PALE_TEXT, PALE_PIPE, PALE_EQUIP } from '../components/ClassicGraphics'
import { highestRankedAlarmState, pictureAlarmSignal, pictureAlarmStateText, pictureFill, pictureLimits, pictureModeSignal, pictureSignal } from '../engine/pictureDynamics'
import { SimulatorDialog } from '../components/SimulatorDialog'
import { pictureNamedSignal } from '../engine/pictureNamedSets'
import { appliedPidOutput } from '../engine/analogStrategy'
import { pictureFlowColor } from '../engine/pictureFlow'
import { useFlowColors } from '../engine/flowColorStore'
import { FlowAnimationControls, FlowTablesDialog } from '../components/PictureFlowControls'
import { CourseDynamo } from '../components/CourseDynamos'
import { DYNAMO_SETS, FONT_FAMILIES, TITLE_GROUP, clampPosition, formatLayout, historicalValue, pictureDiscretePath,
  pictureDiscreteSignal, pictureSourcePaths, refreshedSample, type DynamoSetName } from '../engine/pictureObjects'

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
  useDatabaseClient('DeltaV Operate (Configure)')
  const pictures = usePictures((s) => s.pictures)
  const createPicture = usePictures((s) => s.createPicture)
  const deletePicture = usePictures((s) => s.deletePicture)
  const addElement = usePictures((s) => s.addElement)
  const savePicture = usePictures(s => s.savePicture)
  const loadPicture = usePictures(s => s.loadPicture)
  const createFromTemplate = usePictures(s => s.createPictureFromTemplate)
  const modules = useStore(s => s.modules)
  const names = Object.keys(pictures)
  const [selected, setSelected] = useState<string>(names[0] ?? '')
  const [edit, setEdit] = useState(true)
  const [selEl, setSelEl] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [pictureProperties, setPictureProperties] = useState(false)
  const [flowTablesOpen, setFlowTablesOpen] = useState(false)
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
    const base = { x: 40, y: 60 }
    if (type === 'button') { setSelEl(addElement(selected, { type, ...base, content: 'Overview', target: 'Ovw_ref.grf' })); return }
    const tag = type === 'pump' ? Object.values(modules).find(module => module.type === 'MOTOR')?.tag :
      type === 'valve' ? Object.values(modules).find(module => module.type === 'PID' || module.type === 'VALVE')?.tag :
        modules['LIC-101'] ? 'LIC-101' : Object.values(modules).find(m => m.type === 'AI')?.tag ?? Object.keys(modules)[0]
    const id =
      type === 'text'
        ? addElement(selected, { type, ...base, content: 'Text', fontSize: 14 })
        : addElement(selected, { type, ...base, tag, param: 'PV', label: true,
          ...(type === 'rectangle' ? { width: 64, height: 160 } :
            type === 'pipe' ? { width: 120, height: 12 } : {}) })
    setSelEl(id)
  }

  const addDynamoSet = (set: DynamoSetName): void => {
    if (!pic) return
    const types = DYNAMO_SETS[set].modules
    const tag = Object.values(modules).find(module => types.includes(module.type))?.tag
    if (!tag) { window.alert(`Create a ${types.join(' or ')} module before adding ${DYNAMO_SETS[set].label}`); return }
    setSelEl(addElement(selected, { type: 'dynamo', x: 40, y: 60, tag, dynamoSet: set }))
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
        <button className="tbtn sm" disabled={!newName.trim()} title="Start from the main template: grouped title, background, size"
          onClick={() => {
            if (createFromTemplate(newName, 'MAIN')) {
              setSelected(newName.trim().toUpperCase())
              setNewName('')
            }
          }}>Create from Main Template</button>
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
            <button className="tbtn sm" onClick={() => add('pipe')}>+ Pipe</button>
            <button className="tbtn sm" onClick={() => add('pump')}>+ Pump</button>
            <button className="tbtn sm" onClick={() => add('valve')}>+ Valve</button>
            <button className="tbtn sm" onClick={() => add('button')}>+ Button</button>
            <select className="exp-alm-select" aria-label="Add course dynamo" value=""
              onChange={e => { if (e.target.value) addDynamoSet(e.target.value as DynamoSetName) }}>
              <option value="">+ Course Dynamo…</option>
              {(Object.keys(DYNAMO_SETS) as DynamoSetName[]).map(set => <option key={set} value={set}>{DYNAMO_SETS[set].label}</option>)}
            </select>
            <button className="tbtn sm" onClick={() => setPictureProperties(true)}>Picture Properties</button>
            <button className="tbtn sm" onClick={() => setFlowTablesOpen(true)}>User Flow Tables</button>
          </>
        )}
        <span style={{ flex: 1 }} />
        {pic && (
          <button className="tbtn sm danger" onClick={() => deletePicture(selected)}>
            Delete Picture
          </button>
        )}
      </div>
      {flowTablesOpen && <FlowTablesDialog onClose={() => setFlowTablesOpen(false)} />}

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
  const setBackground = usePictures(s => s.setPictureBackground)
  const removeGroup = usePictures(s => s.removeElementGroup)
  const titleCount = pic.elements.filter(element => element.group === TITLE_GROUP).length
  const [previous, setPrevious] = useState(pic.previousPicture ?? '')
  const [next, setNext] = useState(pic.nextPicture ?? '')
  const [error, setError] = useState('')
  return (
    <div className="bld-props">
      <div className="bld-props-head"><b>Picture</b></div>
      <div className="bld-f" data-picture-template={pic.template}>Template: {pic.template ? 'Main template' : 'none (blank picture)'}</div>
      <label className="bld-f">Background
        <input type="color" aria-label="Picture background" value={pic.background ?? '#eef2f5'}
          onChange={e => setBackground(picture, e.target.value)} />
      </label>
      {titleCount > 0 && <button className="tbtn sm" onClick={() => removeGroup(picture, TITLE_GROUP)}>
        Remove Default Title ({titleCount} objects)</button>}
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
  const background = usePictures((s) => s.pictures[picture]?.background)
  const allPictures = usePictures((s) => s.pictures)
  const navigate = useUi((s) => s.navigate)
  const openPicture = useUi((s) => s.openPicture)
  const updateElement = usePictures((s) => s.updateElement)
  const modules = useStore((s) => s.modules)
  const flowTables = useFlowColors(state => state.tables)
  const alarms = useStore(s => s.alarms)
  const namedContext = useStore(s => s)
  const openFaceplate = useUi((s) => s.openFaceplate)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const [entryId, setEntryId] = useState<string | null>(null)

  useEffect(() => {
    function onMove(e: MouseEvent): void {
      if (!drag.current) return
      const current = usePictures.getState().pictures[picture]
      const moving = current?.elements.find(item => item.id === drag.current?.id)
      const x = e.clientX - drag.current.dx
      const y = e.clientY - drag.current.dy
      updateElement(picture, drag.current.id, moving ? clampPosition(moving, x, y, current) : { x: Math.max(0, x), y: Math.max(0, y) })
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
    <div className="bld-canvas" style={background ? { background } : undefined} data-picture-background={background}
      onMouseDown={() => edit && setSelEl(null)}>
      {els.map((el) => {
        const m = el.tag ? modules[el.tag] : undefined
        const startDrag = (e: React.MouseEvent): void => {
          if (!edit) return
          e.stopPropagation()
          setSelEl(el.id)
          drag.current = { id: el.id, dx: e.clientX - el.x, dy: e.clientY - el.y }
        }
        const sel = edit && selEl === el.id
        const flow = el.flowAnimation ? pictureFlowColor(el.flowAnimation, flowTables, modules) : null
        const actuator = el.actuatorFlowAnimation ? pictureFlowColor(el.actuatorFlowAnimation, flowTables, modules) : null
        const actuatorError = actuator && 'error' in actuator ? actuator.error : undefined
        const actuatorBad = !!actuator && !('error' in actuator) && actuator.bad
        const actuatorColor = actuator && !('error' in actuator) ? actuator.color : actuatorError ? PALE_EQUIP : undefined
        const equipmentMissing = (el.type === 'pump' || el.type === 'valve') && !m
          ? `Equipment module ${el.tag || '(unassigned)'} does not exist` : undefined
        const flowError = equipmentMissing ?? (flow && 'error' in flow ? flow.error : undefined)
        const flowBad = !!flow && !('error' in flow) && flow.bad
        const flowColor = flow && !('error' in flow) ? flow.color : flowError ? PALE_EQUIP : undefined
        const flowTitle = flowError ?? (flowBad ? 'Bad flow feedback; flow state unknown' :
          flow && !('error' in flow) ? `${flow.flowing ? 'Product flow' : 'No flow'} (${el.flowAnimation?.table})` : '')
        if (el.type === 'pipe' || el.type === 'pump' || el.type === 'valve') {
          const pipe = el.type === 'pipe'
          const width = pipe ? el.width ?? 120 : 160
          const height = pipe ? el.height ?? 12 : 90
          const vertical = height > width
          return <svg key={el.id} className={'bld-el' + (sel ? ' sel' : '')}
            width={width} height={height} style={{ left: el.x, top: el.y, zIndex: pipe ? 0 : 1 }}
            onMouseDown={startDrag} onClickCapture={event => { if (edit) event.stopPropagation() }}
            aria-label={`${el.tag ?? ''} ${el.type}${flowError || actuatorError ? `: ${flowError ?? actuatorError}` : flowBad || actuatorBad ? ': Bad' : ''}`}
            data-flow-color={flowColor} data-flow-quality={flowError ? 'ERROR' : flowBad ? 'BAD' : flow ? 'GOOD' : undefined}
            data-actuator-flow-color={actuatorColor}
            data-actuator-flow-quality={actuatorError ? 'ERROR' : actuatorBad ? 'BAD' : actuator ? 'GOOD' : undefined}>
            <title>{flowTitle}{actuatorError ? `; Actuator: ${actuatorError}` : actuatorBad ?
              '; Actuator: Bad feedback' : actuator && !('error' in actuator) ?
                `; Actuator: ${actuator.flowing ? 'Open' : 'Closed'} (${el.actuatorFlowAnimation?.table}; simulated source)` : ''}</title>
            {pipe ? <line x1={vertical ? width / 2 : 0} y1={vertical ? 0 : height / 2}
              x2={vertical ? width / 2 : width} y2={vertical ? height : height / 2}
              stroke={flowColor ?? PALE_PIPE} strokeWidth={3} strokeDasharray={flowBad || flowError ? '4 3' : undefined} /> :
              el.type === 'pump' && m?.type === 'MOTOR' ?
                <ClassicPump x={80} y={40} running={m.running} tag={m.tag} animationColor={flowColor} /> :
              el.type === 'valve' && m?.type === 'PID' ?
                <ClassicControlValve x={80} y={40} position={appliedPidOutput(m)} tag={m.tag} animationColor={flowColor} actuatorAnimationColor={actuatorColor} /> :
              el.type === 'valve' && m?.type === 'VALVE' ?
                <ClassicSanitaryValve x={80} y={40} open={m.open} tag={m.tag} animationColor={flowColor} actuatorAnimationColor={actuatorColor} /> : null}
            {!pipe && (flowError || flowBad || actuatorError || actuatorBad) && <text x={4} y={12} fill={PALE_TEXT} fontSize={10}>
              {flowError || actuatorError ? 'Animation source/table unavailable' : 'Bad animation feedback'}
            </text>}
          </svg>
        }
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
            {!error && <div className="bld-fill" style={{ background: flowColor ?? el.color ?? '#5f7f94',
              width: el.fill?.vertical ? '100%' : `${percent}%`,
              height: el.fill?.vertical ? `${percent}%` : '100%' }} />}
            {(el.width ?? 64) >= 24 && (el.height ?? 160) >= 16 &&
              (error || flowError ? <span className="bld-quality" role="alert">{error ?? flowError}</span> :
                bad || flowBad ? <span className="bld-quality">Bad</span> : null)}
          </div>
        }
        if (el.type === 'text') {
          return (
            <div
              key={el.id}
              className={'bld-el bld-text' + (sel ? ' sel' : '')}
              style={{ left: el.x, top: el.y, fontSize: el.fontSize, fontWeight: el.bold ? 800 : 500, color: el.color,
                fontFamily: el.fontFamily, fontStyle: el.italic ? 'italic' : undefined, textDecoration: el.underline ? 'underline' : undefined }}
              data-group={el.group}
              onMouseDown={startDrag}
            >
              {el.content}
            </div>
          )
        }
        if (el.type === 'button') {
          return <button key={el.id} className={'tbtn bld-el bld-button' + (sel ? ' sel' : '')}
            style={{ left: el.x, top: el.y, width: 140, height: 30 }} onMouseDown={startDrag}
            title={`Opens ${el.target}`} data-target={el.target}
            onClick={(event) => {
              event.stopPropagation()
              if (edit) return
              const target = resolvePictureTarget(el.target ?? '', allPictures)
              if (!target) {
                const message = `Navigation picture not found: ${el.target || '(not configured)'}`
                useStore.getState().logEvent('DIAGNOSTIC', picture, message)
                window.alert(message)
              } else if (target.kind === 'display') navigate(target.display)
              else openPicture(target.name)
            }}>{el.content}</button>
        }
        if (el.type === 'dynamo' && el.dynamoSet) {
          return <CourseDynamo key={el.id} element={el} modules={modules} alarms={alarms} selected={sel} onMouseDown={startDrag}
            onClick={(event) => { event.stopPropagation(); if (!edit && el.tag) openFaceplate(el.tag) }} />
        }
        if (el.type === 'dynamo') {
          return (
            <div
              key={el.id}
              className={'bld-el valbox' + (sel ? ' sel' : '')}
              style={{ left: el.x, top: el.y, position: 'absolute', background: flowColor }}
              title={flowTitle}
              onMouseDown={startDrag}
              onClick={(e) => {
                e.stopPropagation()
                if (!edit && el.tag) openFaceplate(el.tag)
              }}
            >
              <span className="vb-tag">{el.tag}</span>
              <span className="vb-val">{paramValue(m, 'PV')}</span>
              {(flowError || flowBad) && <span role={flowError ? 'alert' : undefined}>{flowError ?? 'Bad flow feedback'}</span>}
            </div>
          )
        }
        const named = el.entry?.method === 'NAMED_SET' || namedContext.sfcLifecycle[el.tag ?? ''] && el.path !== undefined ?
          pictureNamedSignal(el, namedContext, edit) : null
        const isModePath = !!el.path && /^(?:PID1\/)?MODE\.A_(?:TARGET|ACTUAL)(?:\.CV)?$/i.test(el.path.trim())
        const mode = !named && isModePath ? pictureModeSignal(el, modules) : null
        const hideNormalMode = !!el.flashWhenNotNormal && mode && !('error' in mode) && mode.isNormal
        const abnormalMode = !!el.flashWhenNotNormal && mode && !('error' in mode) && mode.isNormal === false
        const isAlarmPath = !!el.path && /^ALARMS\[1\]\.A_LAALM$/i.test(el.path.trim())
        const alarm = !named && isAlarmPath ? pictureAlarmSignal(el, modules, alarms) : null
        const alarmState = isAlarmPath && el.alarmVisibility ? highestRankedAlarmState(el.tag ?? '', alarms) : null
        const alarmHidden = alarmState !== null ? alarmState === 'NORMAL' : !!(alarm && !('error' in alarm) && !alarm.active)
        if (!edit && (hideNormalMode || alarmHidden)) return null
        const discrete = !named && !mode && !alarm && (pictureDiscretePath(el.path) || el.entry?.method === 'DISCRETE') ?
          pictureDiscreteSignal(el, modules) : null
        const signal = !named && !mode && !alarm && !discrete && (el.path || el.entry || el.layout || el.historySeconds !== undefined) ?
          pictureSignal(el, modules) : null
        const failed = (text: string): string => el.errorText?.error ?? text
        let value: string
        if (named) value = 'error' in named ? failed(named.error) : `${named.text}${named.bad ? ' (Bad)' : ''}`
        else if (mode) value = 'error' in mode ? failed(mode.error) : mode.current
        else if (alarm) value = 'error' in alarm ? failed(alarm.error) : alarmState !== null ? pictureAlarmStateText(alarmState) : alarm.text
        else if (discrete) value = 'error' in discrete ? failed(discrete.error) : discrete.bad ? el.errorText?.bad ?? `${discrete.text} (Bad)` : discrete.text
        else if (signal) {
          if ('error' in signal) value = failed(signal.error)
          else if (signal.bad && el.errorText?.bad) value = el.errorText.bad
          else {
            const shown = el.historySeconds !== undefined ? historicalValue(useStore.getState().trend, el.tag ?? '', el.historySeconds) : signal.value
            value = shown === undefined ? 'No history' :
              `${el.layout ? formatLayout(shown, el.layout) : fmt(shown, 2)} ${signal.unit}${signal.bad ? ' (Bad)' : ''}`
          }
        } else value = paramValue(m, el.param ?? 'PV')
        const role = discrete && !('error' in discrete) ? discrete.role : null
        const valueStyle = { color: abnormalMode ? undefined : el.color,
          ...(el.layout ? { fontFamily: 'Consolas, monospace', whiteSpace: 'pre' as const } : {}) }
        return (
          <div
            key={el.id}
            className={'bld-el bld-datalink' + (sel ? ' sel' : '') +
              (abnormalMode ? ' bld-mode-not-normal' : '')}
            style={{ left: el.x, top: el.y }}
            onMouseDown={startDrag}
          >
            {el.label && (
              <span className="bld-dl-label">
                {el.tag}/{el.path ?? el.param}
              </span>
            )}
            {role && <span className="bld-dl-role" data-role={role}>{role === 'command' ? 'SP_D command' : 'PV_D feedback'}</span>}
            {el.entry && !edit ? <button className="bld-entry-value" aria-label={`Enter ${el.tag}/${el.path ?? el.param}`}
              style={valueStyle} onClick={() => setEntryId(el.id)}><HeldText text={value} seconds={el.refreshSeconds} /></button> :
              <span className="bld-dl-val" style={valueStyle}><HeldText text={value} seconds={el.refreshSeconds} /></span>}
          </div>
        )
      })}
      {els.length === 0 && <div className="exp-empty">Empty picture. Add datalinks, text, or dynamos.</div>}
      {!edit && entryId && (els.find(el => el.id === entryId)?.entry?.method === 'NAMED_SET' ?
        <NamedSetEntryDialog picture={picture} id={entryId} onClose={() => setEntryId(null)} /> :
        els.find(el => el.id === entryId)?.entry?.method === 'PID_MODE' ?
          <ModeEntryDialog picture={picture} id={entryId} onClose={() => setEntryId(null)} /> :
          els.find(el => el.id === entryId)?.entry?.method === 'RAMP' ?
            <RampEntryDialog picture={picture} id={entryId} onClose={() => setEntryId(null)} /> :
            els.find(el => el.id === entryId)?.entry?.method === 'DISCRETE' ?
              <DiscreteEntryDialog picture={picture} id={entryId} onClose={() => setEntryId(null)} /> :
            <NumericEntryDialog picture={picture} id={entryId} onClose={() => setEntryId(null)} />)}
    </div>
  )
}

/** Holds a displayed datalink value for its Refresh Rate; with no interval every update shows immediately. */
function HeldText({ text, seconds }: { text: string; seconds?: number }): JSX.Element {
  const held = useRef<{ at: number; value: string }>()
  held.current = refreshedSample(held.current, Date.now(), seconds, text)
  return <>{held.current.value}</>
}

function PropsPanel({ picture, id }: { picture: string; id: string }): JSX.Element | null {
  const el = usePictures((s) => s.pictures[picture]?.elements.find((e) => e.id === id))
  const updateElement = usePictures((s) => s.updateElement)
  const removeElement = usePictures((s) => s.removeElement)
  const modules = useStore((s) => s.modules)
  const sfcLifecycle = useStore(s => s.sfcLifecycle)
  const tags = [...Object.keys(modules), ...(el?.type === 'datalink' ? Object.keys(sfcLifecycle) : [])]
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
              type="number" min={6} max={96}
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
          <label className="bld-f bld-f-row"><input type="checkbox" aria-label="Italic" checked={!!el.italic}
            onChange={(e) => updateElement(picture, id, { italic: e.target.checked })} />Italic</label>
          <label className="bld-f bld-f-row"><input type="checkbox" aria-label="Underline" checked={!!el.underline}
            onChange={(e) => updateElement(picture, id, { underline: e.target.checked })} />Underline</label>
          <label className="bld-f">Font
            <select aria-label="Font family" value={el.fontFamily ?? ''}
              onChange={(e) => updateElement(picture, id, { fontFamily: e.target.value || undefined })}>
              <option value="">Default</option>
              {FONT_FAMILIES.map(family => <option key={family} value={family}>{family}</option>)}
            </select>
          </label>
          <label className="bld-f">Color
            <input type="color" aria-label="Text color" value={el.color ?? '#1a1a1a'}
              onChange={(e) => updateElement(picture, id, { color: e.target.value })} />
          </label>
        </>
      ) : el.type === 'button' ? (
        <>
          <label className="bld-f">Caption
            <input aria-label="Button caption" value={el.content ?? ''} onChange={(e) => updateElement(picture, id, { content: e.target.value })} />
          </label>
          <label className="bld-f">Target picture
            <input aria-label="Button target" value={el.target ?? ''} placeholder="Ovw_ref.grf"
              onChange={(e) => updateElement(picture, id, { target: e.target.value })} />
          </label>
          <p>Opens a created picture, Ovw_ref.grf (Overview) or alarmList.grf (Alarm List) in Run.</p>
        </>
      ) : (
        <>
          <label className="bld-f">
            Module tag
            <select aria-label="Picture module tag" value={el.tag} onChange={(e) => updateElement(picture, id, {
              tag: e.target.value, ...(sfcLifecycle[e.target.value] ? { path: 'MESSAGE', entry: { method: 'NAMED_SET' } } :
                el.entry?.method === 'NAMED_SET' ? { path: undefined, entry: undefined } : {})
            })}>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          {el.type === 'dynamo' && <label className="bld-f">Dynamo set
            <select aria-label="Course dynamo set" value={el.dynamoSet ?? ''}
              onChange={(e) => updateElement(picture, id, e.target.value ?
                { dynamoSet: e.target.value as DynamoSetName } : { dynamoSet: undefined, dynamoColors: undefined, showActiveAlarm: undefined })}>
              <option value="">Generic value box</option>
              {(Object.keys(DYNAMO_SETS) as DynamoSetName[]).map(set => <option key={set} value={set}>{DYNAMO_SETS[set].label}</option>)}
            </select>
          </label>}
          {el.type === 'dynamo' && el.dynamoSet && <>
            <label className="bld-f">Inactive color
              <input type="color" aria-label="Dynamo inactive color" value={el.dynamoColors?.inactive ?? DYNAMO_SETS[el.dynamoSet].defaults[0]}
                onChange={(e) => updateElement(picture, id, { dynamoColors: { active: el.dynamoColors?.active ?? DYNAMO_SETS[el.dynamoSet!].defaults[1], inactive: e.target.value } })} />
            </label>
            <label className="bld-f">Active color
              <input type="color" aria-label="Dynamo active color" value={el.dynamoColors?.active ?? DYNAMO_SETS[el.dynamoSet].defaults[1]}
                onChange={(e) => updateElement(picture, id, { dynamoColors: { inactive: el.dynamoColors?.inactive ?? DYNAMO_SETS[el.dynamoSet!].defaults[0], active: e.target.value } })} />
            </label>
            <label className="bld-f bld-f-row"><input type="checkbox" aria-label="Show active alarm" checked={!!el.showActiveAlarm}
              onChange={(e) => updateElement(picture, id, { showActiveAlarm: e.target.checked || undefined })} />Show active alarm (red outline)</label>
            <p>{DYNAMO_SETS[el.dynamoSet].hint}. Course library objects are isolated; plant mechanical symbols are unchanged.</p>
          </>}
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
          {el.type === 'pipe' && <div className="bld-f bld-f-row">
            <label>Width <input aria-label="Pipe width" type="number" min={1} value={el.width ?? 120}
              onChange={event => updateElement(picture, id, { width: Number(event.target.value) })} /></label>
            <label>Height <input aria-label="Pipe height" type="number" min={1} value={el.height ?? 12}
              onChange={event => updateElement(picture, id, { height: Number(event.target.value) })} /></label>
          </div>}
          {['pipe', 'pump', 'valve', 'rectangle', 'dynamo'].includes(el.type) &&
            <FlowAnimationControls key={`flow-${id}-${el.tag}`} picture={picture} element={el} />}
          {el.type === 'valve' &&
            <FlowAnimationControls key={`actuator-${id}-${el.tag}`} picture={picture} element={el} part="actuator" />}
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
  const modules = useStore(s => s.modules)
  const [path, setPath] = useState(el.path ?? el.param ?? 'PV')
  const [enabled, setEnabled] = useState(!!(el.entry || el.fill))
  const [flashWhenNotNormal, setFlashWhenNotNormal] = useState(el.flashWhenNotNormal ?? false)
  const [alarmVisibility, setAlarmVisibility] = useState(el.alarmVisibility ?? false)
  const [method, setMethod] = useState<'NUMERIC' | 'NAMED_SET' | 'PID_MODE' | 'RAMP' | 'DISCRETE'>(el.entry?.method ?? 'NUMERIC')
  const moduleType = modules[el.tag ?? '']?.type
  const settings = el.entry?.method === 'NUMERIC' ? el.entry : el.fill
  const [fetchLimits, setFetchLimits] = useState(settings?.fetchLimits ?? el.type === 'rectangle')
  const [low, setLow] = useState(String(settings?.low ?? 0))
  const [high, setHigh] = useState(String(settings?.high ?? 1000))
  const [rate, setRate] = useState(String(el.entry?.method === 'RAMP' ? el.entry.rate : 5))
  const [vertical, setVertical] = useState(el.fill?.vertical ?? true)
  const [width, setWidth] = useState(String(el.width ?? 64))
  const [height, setHeight] = useState(String(el.height ?? 160))
  const [color, setColor] = useState(el.color ?? (el.type === 'rectangle' ? '#5f7f94' : PALE_TEXT))
  const [background, setBackground] = useState(el.backgroundColor ?? '#eef2f5')
  const [layoutOn, setLayoutOn] = useState(!!el.layout)
  const [layoutWidth, setLayoutWidth] = useState(String(el.layout?.width ?? 8))
  const [layoutDecimals, setLayoutDecimals] = useState(String(el.layout?.decimals ?? 2))
  const [errBad, setErrBad] = useState(el.errorText?.bad ?? '')
  const [errError, setErrError] = useState(el.errorText?.error ?? '')
  const [refresh, setRefresh] = useState(el.refreshSeconds === undefined ? '' : String(el.refreshSeconds))
  const [history, setHistory] = useState(el.historySeconds === undefined ? '' : String(el.historySeconds))
  const [confirm, setConfirm] = useState(el.entry?.confirm ?? false)
  const discreteLabels = el.entry?.method === 'DISCRETE' ? el.entry.labels : undefined
  const [labelsOn, setLabelsOn] = useState(!!discreteLabels)
  const [label0, setLabel0] = useState(discreteLabels?.[0] ?? 'Stop')
  const [label1, setLabel1] = useState(discreteLabels?.[1] ?? 'Start')
  const [browsing, setBrowsing] = useState(false)
  const numeric = (value: string): number => value.trim() ? Number(value) : NaN
  const rectangle = el.type === 'rectangle'
  return <>
    <div className="bld-props-head"><b>{rectangle ? 'Fill Animation Expert' : 'Data Entry Expert'}</b></div>
    <label className="bld-f">Source Path
      <input aria-label="Picture source path" value={path} onChange={e => {
        const next = e.target.value
        setPath(next)
        if (!/^(?:PID1\/)?MODE\.A_ACTUAL(?:\.CV)?$/i.test(next.trim())) setFlashWhenNotNormal(false)
        if (!/^ALARMS\[1\]\.A_LAALM$/i.test(next.trim())) setAlarmVisibility(false)
      }} />
    </label>
    <button className="tbtn sm" onClick={() => setBrowsing(true)}>Browser…</button>
    {browsing && <SimulatorDialog className="bld-entry-dialog" label="Source Path Browser" onClose={() => setBrowsing(false)}>
      <h3>{el.tag}</h3>
      {pictureSourcePaths(modules[el.tag ?? '']).map(item => <button key={item.path} className="ctx-item"
        onClick={() => { setPath(item.path); setBrowsing(false) }}>{item.path} — {item.description}</button>)}
      <button className="tbtn sm" onClick={() => setBrowsing(false)}>Cancel</button>
    </SimulatorDialog>}
    {!rectangle && <label className="bld-f bld-f-row">
      <input type="checkbox" checked={flashWhenNotNormal}
        disabled={!/^(?:PID1\/)?MODE\.A_ACTUAL(?:\.CV)?$/i.test(path.trim())}
        onChange={e => setFlashWhenNotNormal(e.target.checked)} />
      Flash actual mode red when it differs from normal; hide when normal
    </label>}
    {!rectangle && <label className="bld-f bld-f-row">
      <input type="checkbox" checked={alarmVisibility}
        disabled={!/^ALARMS\[1\]\.A_LAALM$/i.test(path.trim())}
        onChange={e => setAlarmVisibility(e.target.checked)} />
      Alarm Visibility: show the highest-ranked alarm (Active/RTN), hide when Normal
    </label>}
    <label className="bld-f bld-f-row"><input type="checkbox" checked={enabled}
      onChange={e => setEnabled(e.target.checked)} />{rectangle ? 'Fill Percentage' : 'Data Entry'}</label>
    {!rectangle && <label className="bld-f">Entry Method<select aria-label="Picture entry method" value={method}
      onChange={e => {
        const next = e.target.value as 'NUMERIC' | 'NAMED_SET' | 'PID_MODE' | 'RAMP' | 'DISCRETE'
        setMethod(next)
        if (next === 'PID_MODE') setPath('PID1/MODE.A_TARGET')
        else if (next === 'RAMP') setPath('PID1/OUT')
        else if (next === 'DISCRETE') setPath(moduleType === 'DO' ? 'DO1/SP_D' : 'DC1/SP_D')
        else if (method === 'DISCRETE') setPath('PV')
        else if (method === 'PID_MODE' || method === 'RAMP') setPath('PID1/SP')
      }}>
      <option value="NUMERIC">Numeric Entry</option><option value="NAMED_SET">Named Set</option>
      {(modules[el.tag ?? '']?.type === 'PID' || method === 'PID_MODE') &&
        <option value="PID_MODE">Multiple-Item Select (PID Target)</option>}
      {(modules[el.tag ?? '']?.type === 'PID' || method === 'RAMP') &&
        <option value="RAMP">OUT Ramp (Raise/Lower)</option>}
      {(['MOTOR', 'VALVE', 'DO'].includes(moduleType ?? '') || method === 'DISCRETE') &&
        <option value="DISCRETE">Multiple-Item Select (SP_D command)</option>}
    </select></label>}
    {rectangle && <label className="bld-f bld-f-row"><input type="checkbox" checked={vertical}
      onChange={e => setVertical(e.target.checked)} />Vertical Direction</label>}
    {(rectangle || method === 'NUMERIC') && <><label className="bld-f bld-f-row"><input type="checkbox" checked={fetchLimits}
      onChange={e => setFetchLimits(e.target.checked)} />Fetch Limits from Data Source</label>
    <label className="bld-f">Low Limit<input type="number" step="any" disabled={fetchLimits}
      value={low} onChange={e => setLow(e.target.value)} /></label>
    <label className="bld-f">High Limit<input type="number" step="any" disabled={fetchLimits}
      value={high} onChange={e => setHigh(e.target.value)} /></label></>}
    {!rectangle && method === 'RAMP' && <label className="bld-f">Ramp Rate (%/second)
      <input aria-label="Ramp rate" type="number" step="any" min={0} max={100}
        value={rate} onChange={e => setRate(e.target.value)} /></label>}
    {rectangle && <>
      <label className="bld-f">Width<input type="number" value={width} onChange={e => setWidth(e.target.value)} /></label>
      <label className="bld-f">Height<input type="number" value={height} onChange={e => setHeight(e.target.value)} /></label>
      <label className="bld-f">Background<input type="color" value={background} onChange={e => setBackground(e.target.value)} /></label>
    </>}
    {!rectangle && <>
      <label className="bld-f bld-f-row"><input type="checkbox" aria-label="Numeric layout" checked={layoutOn}
        onChange={e => setLayoutOn(e.target.checked)} />Numeric layout (fixed-width field)</label>
      {layoutOn && <div className="bld-f bld-f-row">
        <label>Width <input aria-label="Field width" type="number" min={3} max={24} value={layoutWidth} onChange={e => setLayoutWidth(e.target.value)} /></label>
        <label>Decimals <input aria-label="Decimal places" type="number" min={0} max={6} value={layoutDecimals} onChange={e => setLayoutDecimals(e.target.value)} /></label>
      </div>}
      <label className="bld-f">Error table: Bad quality text<input aria-label="Error text bad" value={errBad} maxLength={24} onChange={e => setErrBad(e.target.value)} /></label>
      <label className="bld-f">Error table: Error text<input aria-label="Error text error" value={errError} maxLength={24} onChange={e => setErrError(e.target.value)} /></label>
      <label className="bld-f">Refresh rate (seconds, blank = every update)<input aria-label="Refresh seconds" type="number" step="any" value={refresh} onChange={e => setRefresh(e.target.value)} /></label>
      <label className="bld-f">History offset (seconds back, blank = current)<input aria-label="History seconds" type="number" step="any" value={history} onChange={e => setHistory(e.target.value)} /></label>
      {enabled && <label className="bld-f bld-f-row"><input type="checkbox" aria-label="Confirm entry" checked={confirm}
        onChange={e => setConfirm(e.target.checked)} />Confirm before writing</label>}
      {enabled && method === 'DISCRETE' && <>
        <label className="bld-f bld-f-row"><input type="checkbox" aria-label="Custom item names" checked={labelsOn}
          onChange={e => setLabelsOn(e.target.checked)} />Custom item names</label>
        {labelsOn && <div className="bld-f bld-f-row">
          <label>Off <input aria-label="Item name off" value={label0} maxLength={20} onChange={e => setLabel0(e.target.value)} /></label>
          <label>On <input aria-label="Item name on" value={label1} maxLength={20} onChange={e => setLabel1(e.target.value)} /></label>
        </div>}
      </>}
    </>}
    <label className="bld-f">Foreground<input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
    <button className="tbtn sm" onClick={() => {
      const limits = { fetchLimits, low: numeric(low), high: numeric(high) }
      const baseEntry: PicElement['entry'] = enabled ? method === 'NAMED_SET' ? { method: 'NAMED_SET' } :
        method === 'PID_MODE' ? { method: 'PID_MODE' } :
        method === 'RAMP' ? { method: 'RAMP', rate: numeric(rate) } :
        method === 'DISCRETE' ? { method: 'DISCRETE', ...(labelsOn ? { labels: [label0, label1] as [string, string] } : {}) } :
        { ...limits, method: 'NUMERIC' } : undefined
      configure(picture, el.id, { path, color, ...(rectangle ? {
        width: numeric(width), height: numeric(height), backgroundColor: background,
        fill: enabled ? { ...limits, vertical } : undefined
      } : { entry: baseEntry && confirm ? { ...baseEntry, confirm: true } : baseEntry,
        layout: layoutOn ? { width: numeric(layoutWidth), decimals: numeric(layoutDecimals) } : undefined,
        errorText: errBad.trim() || errError.trim() ? { ...(errBad.trim() ? { bad: errBad.trim() } : {}), ...(errError.trim() ? { error: errError.trim() } : {}) } : undefined,
        refreshSeconds: refresh.trim() ? numeric(refresh) : undefined,
        historySeconds: history.trim() ? numeric(history) : undefined,
        flashWhenNotNormal: flashWhenNotNormal &&
          /^(?:PID1\/)?MODE\.A_ACTUAL(?:\.CV)?$/i.test(path.trim()) ? true : undefined,
        alarmVisibility: alarmVisibility &&
          /^ALARMS\[1\]\.A_LAALM$/i.test(path.trim()) ? true : undefined }) })
    }}>Apply Expert</button>
    <p>Numeric entry supports PID1/SP and standalone AO Floating Point parameters. PID target selection uses MODE.A_TARGET and its configured permitted modes.</p>
    {!rectangle && <p>Named Set entry uses a saved-lifecycle SFC parameter such as MESSAGE.CV.
      Run reads deployed values; selectable states require Changed Setup Data on both controller and workstation.</p>}
    {!rectangle && <p>OUT ramp entry targets PID1/OUT with Raise/Lower pushbuttons held at the configured
      percent-per-second rate, not typed numeric entry; the PID must be MAN/ROUT and outside LO/OOS.</p>}
  </>
}

function ConfirmPanel({ message, onConfirm, onBack }: { message: string; onConfirm: () => void; onBack: () => void }): JSX.Element {
  return <div role="group" aria-label="Confirm data entry" className="bld-confirm">
    <p><b>Confirm data entry</b></p>
    <p>{message}</p>
    <div className="sfc-edit-row">
      <button className="tbtn sm" onClick={onConfirm}>Confirm</button>
      <button className="tbtn sm" onClick={onBack}>Back</button>
    </div>
  </div>
}

function NumericEntryDialog({ picture, id, onClose }: { picture: string; id: string; onClose: () => void }): JSX.Element {
  const el = usePictures(s => s.pictures[picture]?.elements.find(e => e.id === id))
  const modules = useStore(s => s.modules)
  const write = usePictures(s => s.writeNumericValue)
  const source = el ? pictureSignal(el, modules) : { error: 'Datalink removed' }
  const limits = el?.entry?.method === 'NUMERIC' && !('error' in source) ? pictureLimits(el.entry, source) : undefined
  const [value, setValue] = useState('error' in source ? '' : String(source.value))
  const [pending, setPending] = useState(false)
  const number = value.trim() ? Number(value) : NaN
  return <SimulatorDialog className="bld-entry-dialog" label="Numeric Data Entry" onClose={onClose}>
    {pending ? <ConfirmPanel message={`Change ${el?.tag}/${el?.path ?? el?.param} to ${value}?`}
      onConfirm={() => { if (write(picture, id, number, true)) onClose(); else setPending(false) }} onBack={() => setPending(false)} /> :
    <form noValidate onSubmit={e => {
      e.preventDefault()
      if (el?.entry?.confirm) setPending(true)
      else if (write(picture, id, number)) onClose()
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
    </form>}
  </SimulatorDialog>
}

function ModeEntryDialog({ picture, id, onClose }: { picture: string; id: string; onClose: () => void }): JSX.Element {
  const el = usePictures(s => s.pictures[picture]?.elements.find(item => item.id === id))
  const [expected] = useState(el)
  const modules = useStore(s => s.modules)
  const write = usePictures(s => s.writeModeValue)
  const source = el ? pictureModeSignal(el, modules) : { error: 'Datalink removed' }
  const currentChoice = !('error' in source) && source.choices?.some(mode => mode === source.current)
    ? source.current : ''
  const [value, setValue] = useState(currentChoice)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const applyMode = (confirmed?: boolean): void => {
    if (usePictures.getState().writeModeValue(picture, id, value, expected, confirmed)) onClose()
    else { setPending(false); setError('Mode was not applied; see the reported permission, lifecycle or permitted-mode error.') }
  }
  return <SimulatorDialog className="bld-entry-dialog" label="Multiple-Item Select" onClose={onClose}>
    {pending && <ConfirmPanel message={`Change ${el?.tag}/${el?.path} to ${value}?`} onConfirm={() => applyMode(true)} onBack={() => setPending(false)} />}
    <h3>{el?.tag}/{el?.path}</h3>
    {'error' in source ? <p role="alert">{source.error}</p> : <>
      <p>Current target: {source.current}</p>
      <label>Select target mode<select aria-label="PID target mode" value={value} onChange={e => setValue(e.target.value)}>
        <option value="">Select a target mode</option>
        {(source.choices ?? []).map(mode => <option key={mode} value={mode}>{mode}</option>)}
      </select></label>
      <p>Only modes in MODE.PERMITTED are selectable. LO is an actual mode, not a target.</p>
    </>}
    {error && <p role="alert">{error}</p>}
    <div className="sfc-edit-row">
      <button className="tbtn sm" disabled={!value || 'error' in source || pending}
        onClick={() => { if (el?.entry?.confirm) setPending(true); else applyMode() }}>Apply Mode</button>
      <button className="tbtn sm" onClick={onClose}>Cancel Entry</button>
    </div>
  </SimulatorDialog>
}

function RampEntryDialog({ picture, id, onClose }: { picture: string; id: string; onClose: () => void }): JSX.Element {
  const el = usePictures(s => s.pictures[picture]?.elements.find(item => item.id === id))
  const [expected] = useState(el)
  const modules = useStore(s => s.modules)
  const source = el ? pictureSignal(el, modules) : { error: 'Datalink removed' }
  const [error, setError] = useState('')
  const [holding, setHolding] = useState<1 | -1 | null>(null)
  const [confirmed, setConfirmed] = useState(!el?.entry?.confirm)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickSeconds = 0.2
  const stop = (): void => {
    if (timer.current !== null) { clearInterval(timer.current); timer.current = null }
    setHolding(null)
  }
  useEffect(() => stop, [])
  const start = (direction: 1 | -1): void => {
    stop()
    setHolding(direction)
    const nudge = (): void => {
      if (!usePictures.getState().rampOutput(picture, id, direction, tickSeconds, expected, confirmed)) {
        setError('OUT was not ramped; see the reported permission, mode or lifecycle error.')
        stop()
      }
    }
    nudge()
    timer.current = setInterval(nudge, tickSeconds * 1000)
  }
  const rate = el?.entry?.method === 'RAMP' ? el.entry.rate : 0
  return <SimulatorDialog className="bld-entry-dialog" label="OUT Ramp Data Entry" onClose={() => { stop(); onClose() }}>
    <h3>{el?.tag}/{el?.path}</h3>
    {'error' in source ? <p role="alert">{source.error}</p> :
      <p>Current OUT: {fmt(source.value, 1)} {source.unit}{source.bad ? ' (Bad)' : ''}
        {holding ? ` — ${holding > 0 ? 'Raising' : 'Lowering'}…` : ''}</p>}
    {!confirmed && <ConfirmPanel message={`Enable OUT ramp of ${el?.tag} at ${rate}%/second?`} onConfirm={() => setConfirmed(true)} onBack={onClose} />}
    <p>Hold Raise or Lower to ramp the output at {rate}%/second; release to stop immediately.
      The PID must be MAN/ROUT and outside LO/OOS.</p>
    {error && <p role="alert">{error}</p>}
    <div className="sfc-edit-row">
      <button className="tbtn sm" disabled={'error' in source || !confirmed}
        onMouseDown={() => start(-1)} onMouseUp={stop} onMouseLeave={stop}>▼ Lower</button>
      <button className="tbtn sm" disabled={'error' in source || !confirmed}
        onMouseDown={() => start(1)} onMouseUp={stop} onMouseLeave={stop}>▲ Raise</button>
      <button className="tbtn sm" type="button" onClick={() => { stop(); onClose() }}>Close</button>
    </div>
  </SimulatorDialog>
}

function NamedSetEntryDialog({ picture, id, onClose }: { picture: string; id: string; onClose: () => void }): JSX.Element {
  const el = usePictures(s => s.pictures[picture]?.elements.find(item => item.id === id))
  const [expected] = useState(el)
  const state = useStore(s => s)
  const source = el ? pictureNamedSignal(el, state) : { error: 'Datalink removed' }
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const applyNamed = (confirmed?: boolean): void => {
    if (usePictures.getState().writeNamedValue(picture, id, Number(value), expected, confirmed)) onClose()
    else { setPending(false); setError('Value was not applied; see the reported permission, staleness or setup error.') }
  }
  return <SimulatorDialog className="bld-entry-dialog" label="Named Set Data Entry" onClose={onClose}>
    {pending && <ConfirmPanel message={`Write ${el?.tag}/${el?.path} = ${value}?`} onConfirm={() => applyNamed(true)} onBack={() => setPending(false)} />}
    <h3>{el?.tag}/{el?.path}</h3>
    {'error' in source ? <p role="alert">{source.error}</p> : <>
      <p>Current: {source.text} ({source.value}){source.bad ? ' — Bad/unavailable setup or controller' : ''}</p>
      <label>Select state<select aria-label="Named Set value" value={value} onChange={e => setValue(e.target.value)}>
        <option value="">Select a command</option>
        {source.choices.map(entry => <option key={`${entry.name}:${entry.value}`} value={entry.value}>{entry.name}</option>)}
      </select></label>
      <p>Only visible, user-selectable states matching the workstation and controller setup are offered.</p>
    </>}
    {error && <p role="alert">{error}</p>}
    <div className="sfc-edit-row">
      <button className="tbtn sm" disabled={!value || 'error' in source || source.bad || pending}
        onClick={() => { if (el?.entry?.confirm) setPending(true); else applyNamed() }}>Apply Value</button>
      <button className="tbtn sm" onClick={onClose}>Cancel Entry</button>
    </div>
  </SimulatorDialog>
}

function DiscreteEntryDialog({ picture, id, onClose }: { picture: string; id: string; onClose: () => void }): JSX.Element {
  const el = usePictures(s => s.pictures[picture]?.elements.find(item => item.id === id))
  const [expected] = useState(el)
  const modules = useStore(s => s.modules)
  const command = el ? pictureDiscreteSignal(el, modules) : { error: 'Datalink removed' }
  const feedback = el?.path ? pictureDiscreteSignal({ ...el, entry: undefined, path: el.path.replace(/SP_D/i, 'PV_D') }, modules) : { error: 'No feedback path' }
  const [choice, setChoice] = useState<'' | '0' | '1'>('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const apply = (confirmed?: boolean): void => {
    if (usePictures.getState().writeDiscreteValue(picture, id, choice === '1', expected, confirmed)) onClose()
    else { setPending(false); setError('The command was not applied; see the reported permission, signature or device error.') }
  }
  const labels = 'error' in command ? ['', ''] : command.labels
  return <SimulatorDialog className="bld-entry-dialog" label="Multiple-Item Select (SP_D)" onClose={onClose}>
    <h3>{el?.tag}/{el?.path}</h3>
    {'error' in command ? <p role="alert">{command.error}</p> : <>
      <p>SP_D command: <b>{command.text}</b>{'error' in feedback ? '' : <> · PV_D feedback: <b>{feedback.text}</b>{feedback.bad ? ' (Bad)' : ''}</>}</p>
      <label>Select command<select aria-label="Discrete command" value={choice} onChange={e => setChoice(e.target.value as '' | '0' | '1')}>
        <option value="">Select a command</option>
        <option value="0">{labels[0]}</option>
        <option value="1">{labels[1]}</option>
      </select></label>
      <p>The selection writes the SP_D command; PV_D feedback follows the device and is never written.</p>
    </>}
    {pending && <ConfirmPanel message={`Send ${choice === '1' ? labels[1] : labels[0]} to ${el?.tag}?`} onConfirm={() => apply(true)} onBack={() => setPending(false)} />}
    {error && <p role="alert">{error}</p>}
    <div className="sfc-edit-row">
      <button className="tbtn sm" disabled={!choice || 'error' in command || pending}
        onClick={() => { if (el?.entry?.confirm) setPending(true); else apply() }}>Apply Command</button>
      <button className="tbtn sm" onClick={onClose}>Cancel Entry</button>
    </div>
  </SimulatorDialog>
}
