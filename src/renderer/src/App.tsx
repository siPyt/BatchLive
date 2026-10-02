import { useEffect, useRef } from 'react'
import { useStore } from './engine/store'
import { useUi } from './ui/uiStore'
import { compareAlarmRank } from './utils/format'
import { AlarmBanner } from './components/AlarmBanner'
import { TopBar } from './components/TopBar'
import { NavSidebar } from './components/NavSidebar'
import { StatusBar } from './components/StatusBar'
import { FlexLockOverlay } from './components/FlexLockOverlay'
import { AccessDeniedToast } from './components/AccessDeniedToast'
import { AlarmAudio } from './components/AlarmAudio'
import { FaceplateHost } from './faceplates/FaceplateHost'
import { OverviewDisplay } from './displays/OverviewDisplay'
import { AreaDisplay } from './displays/AreaDisplay'
import { AlarmSummary } from './displays/AlarmSummary'
import { EventJournalDisplay } from './displays/EventJournalDisplay'
import { TrendDisplay } from './displays/TrendDisplay'
import { ExplorerDisplay } from './displays/ExplorerDisplay'
import { ControlStudioDisplay } from './displays/ControlStudioDisplay'
import { BatchDisplay } from './displays/BatchDisplay'
import { SfcDisplay } from './displays/SfcDisplay'
import { DisplayBuilder } from './displays/DisplayBuilder'
import { WorkshopsDisplay } from './displays/WorkshopsDisplay'
import { UserManagerDisplay } from './displays/UserManagerDisplay'
import { PhysicalNetworkDisplay } from './displays/PhysicalNetworkDisplay'

export function App(): JSX.Element {
  const tick = useStore((s) => s.tick)
  const display = useUi((s) => s.display)
  const last = useRef<number>(performance.now())

  // Fixed-rate simulation loop (~10 Hz) decoupled from render.
  useEffect(() => {
    let raf = 0
    let acc = 0
    const STEP = 0.1 // seconds
    const loop = (now: number): void => {
      const dt = Math.min(0.5, (now - last.current) / 1000)
      last.current = now
      acc += dt
      while (acc >= STEP) {
        tick(STEP)
        acc -= STEP
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [tick])

  // Operator console hotkeys: F8 Silence Horn, F9 Acknowledge top alarm.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'F8') {
        e.preventDefault()
        useStore.getState().silenceHorn()
      } else if (e.key === 'F9') {
        e.preventDefault()
        const top = [...useStore.getState().alarms].sort(compareAlarmRank)[0]
        if (top) useStore.getState().ackAlarm(top.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="app-shell">
      <AlarmBanner />
      <TopBar />
      <div className="app-body">
        <NavSidebar />
        <div className="main-area">
          {display === 'overview' && <OverviewDisplay />}
          {display === 'feed' && <AreaDisplay area="FEED" />}
          {display === 'reactor' && <AreaDisplay area="REACTOR" />}
          {display === 'product' && <AreaDisplay area="PRODUCT" />}
          {display === 'wfi' && <AreaDisplay area="WFI" />}
          {display === 'autoclave' && <AreaDisplay area="AUTOCLAVE" />}
          {display === 'lyo' && <AreaDisplay area="LYO" />}
          {display === 'cip' && <AreaDisplay area="CIP" />}
          {display === 'tcu' && <AreaDisplay area="TCU" />}
          {display === 'alarms' && <AlarmSummary />}
          {display === 'journal' && <EventJournalDisplay />}
          {display === 'trend' && <TrendDisplay />}
          {display === 'explorer' && <ExplorerDisplay />}
          {display === 'studio' && <ControlStudioDisplay />}
          {display === 'batch' && <BatchDisplay />}
          {display === 'sfc' && <SfcDisplay />}
          {display === 'builder' && <DisplayBuilder />}
          {display === 'workshops' && <WorkshopsDisplay />}
          {display === 'users' && <UserManagerDisplay />}
          {display === 'hardware' && <PhysicalNetworkDisplay />}
          <FaceplateHost />
        </div>
      </div>
      <StatusBar />
      <AccessDeniedToast />
      <FlexLockOverlay />
      <AlarmAudio />
    </div>
  )
}
