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
import { OverviewDisplay, SpatialProcessDisplay } from './displays/OverviewDisplay'
import { PhotoPlantDisplay } from './displays/PhotoPlantDisplay'
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
  const navigationOpen = useUi((s) => s.navigationOpen)
  const processViewRevision = useUi((s) => s.processViewRevision)
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
      <TopBar />
      <div className="app-body">
        {navigationOpen && <NavSidebar />}
        <div className="main-area">
          {display === 'overview' && <OverviewDisplay key={processViewRevision} />}
          {display === 'plant-map' && <SpatialProcessDisplay key={processViewRevision} />}
          {display === 'photo-overview' && <PhotoPlantDisplay view="overview" />}
          {display === 'photo-n3' && <PhotoPlantDisplay view="n3" />}
          {display === 'photo-n1' && <PhotoPlantDisplay view="n1" />}
          {display === 'photo-n1bp' && <PhotoPlantDisplay view="n1bp" />}
          {display === 'photo-still' && <PhotoPlantDisplay view="still" />}
          {display === 'feed' && <AreaDisplay key={`feed-${processViewRevision}`} area="FEED" />}
          {display === 'reactor' && <AreaDisplay key={`reactor-${processViewRevision}`} area="REACTOR" />}
          {display === 'product' && <AreaDisplay key={`product-${processViewRevision}`} area="PRODUCT" />}
          {display === 'wfi' && <AreaDisplay key={`wfi-${processViewRevision}`} area="WFI" />}
          {display === 'autoclave' && <AreaDisplay key={`autoclave-${processViewRevision}`} area="AUTOCLAVE" />}
          {display === 'lyo' && <AreaDisplay key={`lyo-${processViewRevision}`} area="LYO" />}
          {display === 'cip' && <AreaDisplay key={`cip-${processViewRevision}`} area="CIP" />}
          {display === 'tcu' && <AreaDisplay key={`tcu-${processViewRevision}`} area="TCU" />}
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
      <AlarmBanner />
      <StatusBar />
      <AccessDeniedToast />
      <FlexLockOverlay />
      <AlarmAudio />
    </div>
  )
}
