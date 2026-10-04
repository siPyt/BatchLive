import type { DisplayId } from '../ui/uiStore'

// DV-09 workshops re-expressed as step-by-step exercises performed with
// BatchLive's own tools. Faithful to the manual's intent; "goto" jumps the
// learner to the BatchLive display that stands in for the DeltaV application.

export interface WStep {
  id: string
  text: string
  goto?: DisplayId
}

export interface Workshop {
  id: string
  title: string
  objective: string
  note?: string
  steps: WStep[]
}

export interface WModule {
  module: string
  workshops: Workshop[]
}

export const COURSE: WModule[] = [
  {
    module: 'DV-09 · Controller Commissioning',
    workshops: [
      {
        id: 'dv09-commissioning',
        title: 'Commissioning the Controller',
        objective: 'Identify, commission, auto-sense and configure a five-minute cold restart (DV-09 PDF pages 55-67).',
        note: 'Physical Network provides simulated controllers, CHARM I/O and a traditional AI/AO/DI/DO card subset. Windows logon, Explorer drag-and-drop commissioning, full controller alarm properties and real downloads are not implemented equivalents.',
        steps: [
          { id: 'dv09-ctlr-1', text: 'Open Physical Network. Use Add Decommissioned Controller to create a named training controller, or decommission CTLR-01 if you intend to test the existing I/O.', goto: 'hardware' },
          { id: 'dv09-ctlr-2', text: 'Click Identify and confirm IDENTIFY FLASHING. Click Stop Identify to stop it.' },
          { id: 'dv09-ctlr-3', text: 'Select Redundant control network and click Commission. Confirm the controller becomes COMMISSIONED with an assigned simulated address.' },
          { id: 'dv09-ctlr-4', text: 'Answer Yes to Auto-sense I/O and inspect the detected-channel summary. A newly created controller with no attached I/O correctly reports zero channels.' },
          { id: 'dv09-ctlr-5', text: 'Set Cold Restart to 5 minutes and click Apply Properties. Confirm the saved value remains 5.' },
          { id: 'dv09-ctlr-6', text: 'Verify the alternate commissioning path by answering No: the controller remains commissioned without a new I/O scan. Use Auto-sense I/O later to scan explicitly.' }
        ]
      }
    ]
  },
  {
    module: 'DV-09 · Plant Areas & Control Modules',
    workshops: [
      {
        id: 'areas',
        title: 'Defining Plant Areas',
        objective: 'Create and rename plant areas, following DV-09 PDF pages 87-88 (printed 2-16 to 2-17).',
        note: 'The existing pharma project is retained. Create AREA_A first as the training prerequisite; no plant drawings are renamed or redesigned. This verifies area editing only, not the full Area / Process Cell / Unit batch hierarchy or area-specific privileges.',
        steps: [
          { id: 'areas-dv09-1', text: 'Open DeltaV Explorer.', goto: 'explorer' },
          { id: 'areas-dv09-2', text: 'Right-click Control Strategies → New Area. Replace the selected AREA1 name with AREA_A and press Enter (training setup).' },
          { id: 'areas-dv09-3', text: 'Right-click AREA_A → Rename. Enter PLANT_AREA_A and press Enter. Confirm the new name appears in Explorer.' },
          { id: 'areas-dv09-4', text: 'Right-click Control Strategies → New Area. Replace the selected generated name with PLANT_AREA_B and press Enter.' },
          { id: 'areas-dv09-5', text: 'Create a control module in PLANT_AREA_A and confirm both new areas are offered in the Control Module, Equipment Module and SFC area selectors.' }
        ]
      },
      {
        id: 'dv09-traditional-discrete',
        title: 'Course DSTs and XV-101 / XVSTAT-101 Discrete Signals',
        objective: 'Configure the course channel assignments and trace command, applied output, feedback and alarm-on-zero (DV-09 PDF pages 89-91, 117-124 and 155).',
        note: 'Verified simulator subset, not the complete native workshop. Use a separate preview/session for a blank training project: File → New Blank Project discards the active project after confirmation. Do not replace the pharma baseline XV-101 valve. Settings are immediately live/session-local; CAS, DISCRETE templates, Tank101 assignment and Save/Download/Online are still absent. The DO-to-DI tieback is simulated, not physical wiring.',
        steps: [
          { id: 'dv09-io-1', text: 'In a separate training session, choose File → New Blank Project. Create PLANT_AREA_A in Explorer, then add and commission a training controller in Physical Network.', goto: 'hardware' },
          { id: 'dv09-io-2', text: 'Under that controller, use New Card to create C01 AI, C02 AO, C03 DI and C04 DO in slots 1, 2, 3 and 4.' },
          { id: 'dv09-io-3', text: 'Expand channels 1 and 2 in each card, set DST, select Enable and Apply Channel Properties: C01 LT-1 / FT-2; C02 LY-1 / FY-2; C03 LSO-1 / XI-2; C04 XV-1 / ZX-2. The analog DST exercise below binds AI/PID stages; a standalone course AO module is still absent.' },
          { id: 'dv09-io-4', text: 'Set C03 channel 1 Simulated tieback to XV-1 and apply. Auto-sense I/O should detect 32 installed channels on the four eight-channel cards, regardless of which channels are enabled.' },
          { id: 'dv09-io-5', text: 'In Explorer, create Type DO, Tag XV-101, Area PLANT_AREA_A; create Type DI, Tag XVSTAT-101 in the same area.', goto: 'explorer' },
          { id: 'dv09-io-6', text: 'Open XV-101 in Control Studio. Select IO_OUT XV-1 and MODE.TARGET AUTO. Open XVSTAT-101, select IO_IN LSO-1, ON VALUE 0 and enable the discrete alarm.', goto: 'studio' },
          { id: 'dv09-io-7', text: 'Run the simulation. With output 0 and valid feedback 0, confirm the XVSTAT-101 discrete alarm is active. Toggle XV-101 SP_D to 1: C04 channel 1 must become 1, then XVSTAT-101 feedback becomes 1 on the following scan and the alarm returns.' },
          { id: 'dv09-io-8', text: 'Select output OOS, or disable C04 channel 1. Confirm the last applied signal holds, both bound modules report Bad after the scan boundary, and OOS removes/disables output commands. Restore AUTO and Enable, then verify recovery.' },
          { id: 'dv09-io-9', text: 'Disconnect the C03 channel 1 simulated tieback to use Set Simulated Input with 0 or 1. A connected tieback cannot be overridden. Rename an in-use DST only after disconnecting its module bindings and tiebacks.' }
        ]
      },
      {
        id: 'xv101',
        title: 'Supplemental XV-301 On-off Valve Exercise',
        objective: 'Define a new discrete output (valve) control module and operate it.',
        note: 'Supplemental pharma device exercise, not the DV-09 XV-101 DO block / DST / download procedure. Use the course DST exercise above for verified discrete channel behavior.',
        steps: [
          { id: 'xv-1', text: 'In DeltaV Explorer, click ＋ New Module.', goto: 'explorer' },
          { id: 'xv-2', text: 'Set Type = VALVE (on/off), Tag = XV-301, Description = TEST VALVE, Area = FEED.' },
          { id: 'xv-3', text: 'Click Create. XV-301 appears in the FEED area.' },
          { id: 'xv-4', text: 'Select XV-301 and click Faceplate, then use OPEN / CLOSE to command it.' },
          {
            id: 'xv-5',
            text: 'Try Force Interlock: DC_STATE goes to SHUTDOWN/INTERLOCKED. Click Clear Interlock, then RESET (Reset Required) to let it resume.'
          }
        ]
      },
      {
        id: 'xvstat',
        title: 'Supplemental XVSTAT-301 Local Discrete Input',
        objective: 'Define a discrete input used to monitor a device status.',
        note: 'This local-input introduction does not bind a DST or reproduce the DISCRETE template and download lifecycle.',
        steps: [
          { id: 'xvs-1', text: 'In DeltaV Explorer, click ＋ New Module.', goto: 'explorer' },
          { id: 'xvs-2', text: 'Set Type = DI (Discrete Input), Tag = XVSTAT-301, Area = FEED.' },
          { id: 'xvs-3', text: 'Click Create and open its faceplate to view the status.' }
        ]
      }
    ]
  },
  {
    module: 'DV-09 · Equipment Hierarchy',
    workshops: [
      {
        id: 'equipment',
        title: 'Equipment Modules (Area ▸ Unit ▸ Equipment Module ▸ Control Module)',
        objective: 'Group Control Modules into an Equipment Module, matching the DeltaV physical/equipment hierarchy.',
        note:
          'Per the manual: Area (plant location) → Process Cell → Unit Module (key to the Batch hierarchy) → Equipment Module (a grouping of equipment performing a minor task, e.g. a totalizer or header) → Control Module (a single motor or flow loop). BatchLive simplifies Unit = Area (one Unit per Area) and models Area ▸ Equipment Module ▸ Control Module directly in DeltaV Explorer.',
        steps: [
          { id: 'eq-1', text: 'Open DeltaV Explorer and expand FEED — note EM-FEED-SUPPLY already groups FIC-101, LIC-101, P-101, XV-101, TI-101 and LSH-101.', goto: 'explorer' },
          { id: 'eq-2', text: 'Right-click the REACTOR area → New ▸ Equipment Module…, Tag = EM-REACTOR-COOLING, Area = REACTOR, Create.' },
          { id: 'eq-3', text: 'Right-click your new EM-REACTOR-COOLING → New ▸ Control Module… to create a module pre-assigned to it (e.g. a VALVE tag XV-302).' },
          { id: 'eq-4', text: 'Select any existing Control Module (e.g. TI-101) and use the Equipment Module dropdown in its properties panel to move it between Equipment Modules, or back to (Unassigned).' },
          { id: 'eq-5', text: 'Right-click an Equipment Module and choose Delete Equipment Module — its members fall back to (Unassigned), they are not deleted.' }
        ]
      }
    ]
  },
  {
    module: 'Physical Network (Controllers & CHARM I/O)',
    workshops: [
      {
        id: 'hardware',
        title: 'Controllers, I/O Carriers and CHARMs',
        objective: 'Explore the physical hardware layer and see I/O faults propagate into Control Modules.',
        note:
          'Not from the DV-09 PDFs — those predate CHARM I/O / Electronic Marshalling (they still show traditional 8-channel I/O cards in the Overview module). This is modeled from general published DeltaV CHARM I/O architecture instead: CTLR-01 is a redundant controller; CIOC-01 is its I/O Carrier; CB-01/02/03 are CHARM Baseplates, each CHARM carrying exactly one field signal, auto-characterized by type (AI, AI HART, AO, DI, DO, RTD).',
        steps: [
          { id: 'hw-1', text: 'Open Physical Network and review CTLR-01: Primary ACTIVE / Secondary STANDBY, scan time and CPU load.', goto: 'hardware' },
          { id: 'hw-2', text: 'Find the CHARM bound to TI-101/PV on baseplate CB-02 and click ⇥ to pull it — TI-101\'s PV freezes and a PVBAD alarm appears in the banner.' },
          { id: 'hw-3', text: 'Click ⇤ to reinsert the CHARM — the PVBAD alarm clears and TI-101 resumes tracking the process.' },
          { id: 'hw-4', text: 'Pull the CHARM bound to P-101/CMD (CB-02) — P-101 goes to a FAIL condition exactly like Inject Fault, because its output wiring is gone.' },
          { id: 'hw-5', text: 'Click Fail Primary on CTLR-01 — it switches to the Secondary bumplessly (no process impact). Click Fail again to take out the Secondary too — every bound loop freezes and every bound motor/valve faults, because the whole controller is down.' },
          { id: 'hw-6', text: 'Click Restore — Primary comes back ACTIVE / Secondary STANDBY and the frozen loops resume updating.' },
          { id: 'hw-7', text: 'Log on as OperatorA (Utilities → User Manager) and confirm Fail/Restore/Pull/Reinsert are all blocked — they require the Diagnostic key, which OperatorA lacks.' }
        ]
      }
    ]
  },
  {
    module: 'DV-09 · Operator Graphics',
    workshops: [
      {
        id: 'newpic',
        title: 'Creating a New Picture (Tank201)',
        objective: 'Create a new operator display picture.',
        steps: [
          { id: 'pic-1', text: 'Open the Display Builder.', goto: 'builder' },
          { id: 'pic-2', text: 'Type TANK201 in the New picture field and click Create.' },
          { id: 'pic-3', text: 'The new picture opens on the silver configure canvas, ready for objects.' }
        ]
      },
      {
        id: 'dv09-picture-links',
        title: 'Configuring Previous / Next Pictures',
        objective: 'Configure and operate the navigation required by DV-09 PDF pages 134-136.',
        note: 'Display Builder stores links on the picture in the current session. The two course .grf names resolve to BatchLive Overview and Alarm List; custom picture names link to other builder pictures. This is not a native DeltaV .grf file/template export.',
        steps: [
          { id: 'dv09-piclink-1', text: 'Open Display Builder, select TANK101 and stay in Configure mode.', goto: 'builder' },
          { id: 'dv09-piclink-2', text: 'Click Previous Picture or Next Picture to open the Previous / Next Picture properties.' },
          { id: 'dv09-piclink-3', text: 'Set Previous Picture Name = Ovw_ref.grf and Next Picture Name = alarmList.grf. Click Apply Links.' },
          { id: 'dv09-piclink-4', text: 'Switch to Run. Click Previous Picture and verify Overview opens. Return to Display Builder, switch to Run and click Next Picture; verify Alarm List opens.' },
          { id: 'dv09-piclink-5', text: 'Create a second builder picture, configure its name as the Next target, and verify Run navigation selects that picture. No automatic reciprocal link is created.' }
        ]
      },
      {
        id: 'datalink',
        title: 'Adding a Datalink',
        objective: 'Bind a live process value (DVSYS.MODULE/PARAM) onto the picture.',
        steps: [
          { id: 'dl-1', text: 'In the Display Builder with TANK201 selected, click + Datalink.', goto: 'builder' },
          { id: 'dl-2', text: 'In the properties panel set Module tag = LIC-201 and Parameter = PV.' },
          { id: 'dl-3', text: 'Enable Show label, then drag the datalink to position it.' },
          { id: 'dl-4', text: 'Add a second datalink for TIC-201 / PV.' }
        ]
      },
      {
        id: 'text',
        title: 'Creating Static Text',
        objective: 'Label the picture with static text.',
        steps: [
          { id: 'tx-1', text: 'Click + Text in the Display Builder.', goto: 'builder' },
          { id: 'tx-2', text: 'In properties set Content = TANK 201 REACTOR, Font size = 16, Bold = on.' },
          { id: 'tx-3', text: 'Drag the text above the datalinks.' }
        ]
      },
      {
        id: 'dynamo',
        title: 'Adding a Dynamo',
        objective: 'Place an equipment dynamo that opens its faceplate.',
        steps: [
          { id: 'dy-1', text: 'Click + Dynamo and set its Module tag = P-201.', goto: 'builder' },
          { id: 'dy-2', text: 'Click ▷ Run to switch the picture to run mode.' },
          { id: 'dy-3', text: 'Click the P-201 dynamo to open its faceplate and operate it.' }
        ]
      }
    ]
  },
  {
    module: 'DV-09 · Analog & Regulatory Control',
    workshops: [
      {
        id: 'dv09-pid-oos-lo',
        title: 'PID OOS and Tracking LO',
        objective: 'Execute pp246-247 algorithm stop, independent input quality, tracking override and return to target.',
        note: 'This is the modeled mode subset, not a native mode bitmask or remote-host/Fieldbus protocol. Normal is informational; Permitted gates target selections. Use a separate training session; independent manual AO blocks continue to execute when PID1 is OOS.',
        steps: [
          { id: 'dv09-pid-mode-0', text: 'Open or create the PID in Studio. Inspect MODE.NORMAL (informational only) and MODE.ISAN. Temporarily set MODE.PERMITTED to AUTO and OOS; verify the algorithm is not forced into OOS and CAS target requests reject. Restore all target modes before continuing.', goto: 'studio' },
          { id: 'dv09-pid-mode-1', text: 'Open a PID in Studio. Select AI1, choose MAN input and a constant PV. Select PID1 and request AUTO. Create an unbound DO TRK-TEST as an explicit simulated tracking trigger.', goto: 'studio' },
          { id: 'dv09-pid-mode-2', text: 'Select TRK-TEST for tracking source, set tracking value35%, and enable tracking. Toggle TRK-TEST on from its faceplate. After sampling, confirm target AUTO, actual LO, requested output35% and separate applied AO output.' },
          { id: 'dv09-pid-mode-3', text: 'Toggle the trigger off. Confirm actual returns to AUTO without an immediate proportional or derivative kick. LO is not offered as a target. Output entry cannot override LO.' },
          { id: 'dv09-pid-mode-4', text: 'Select OOS from the PID faceplate or PID1 target selector. Confirm the PID algorithm stops, its output holds Bad, and AI1 remains independently Good. Return to AUTO and verify recovery.' },
          { id: 'dv09-pid-mode-5', text: 'Make the trigger OOS while tracking is enabled. Confirm held applied output, actual IMAN and a visible tracking diagnostic; restore the trigger to recover. A missing or Bad tracking-value source also cannot supply a successful override.' },
          { id: 'dv09-pid-mode-6', text: 'In an SFC action/transition editor, use PID1/MODE.TARGET := 1 for OOS and PID1/MODE.ACTUAL = 4 for LO. Target CAS48 differs from actual CAS32. Target LO/4 and unsupported numeric masks reject. Save/Load retains supported conditions.', goto: 'sfc' }
        ]
      },
      {
        id: 'dv09-fic102-picture-entry',
        title: 'FIC-102 Picture Setpoint and Mode Entry',
        objective: 'Configure bounded PID1/SP numeric entry, a permitted-mode selector and active-alarm visibility from the p256 operator-picture exercise.',
        note: 'Numeric setpoint, target-mode entry and simulator alarm-active visibility are executable. OUT ramp entry, valve/actuator animation and PipesAnim connections are not yet implemented; native alarm-index behavior is not claimed.',
        steps: [
          { id: 'dv09-fic-pic-1', text: 'In Display Builder, open TANK101 and add a datalink for FIC-102. In Data Entry Expert set Source Path PID1/SP, enable Data Entry, choose Numeric Entry and Fetch Limits from Data Source, then Apply Expert.', goto: 'builder' },
          { id: 'dv09-fic-pic-2', text: 'Add another FIC-102 datalink. Enable Data Entry, choose Multiple-Item Select (PID Target), confirm Source Path PID1/MODE.A_TARGET, and Apply Expert. Add read-only datalinks at PID1/MODE.A_ACTUAL and ALARMS[1].A_LAALM.', goto: 'builder' },
          { id: 'dv09-fic-pic-3', text: 'Switch to Run. Enter a setpoint within the module engineering range and select a permitted target mode. Out-of-range values, modes outside MODE.PERMITTED, and writes while the managed PID is Offline must reject without changing runtime.', goto: 'builder' },
          { id: 'dv09-fic-pic-4', text: 'Drive FIC-102 into and out of an enabled alarm threshold. The alarm datalink must appear only while a simulator alarm for FIC-102 is active. Cancel an open entry and confirm no write occurs. OUT ramp, animated valve/actuator dynamos and PipesAnim remain uncovered.' }
        ]
      },
      {
        id: 'dv09-standalone-ao',
        title: 'LEVEL-101 Standalone AO and CAS_SP',
        objective: 'Build the actual AO/CAS_SP path and verify applied channel output with a simulated LI-101 tieback.',
        note: 'Use a separate blank training session. This is the executable AO/signal subset of pp164-168 and pp173-178, not the complete workshop. Standalone AO now offers the opt-in saved lifecycle in the next exercise. Native properties/templates remain absent. Picture-level numeric entry and source-scaled fill are modeled but are not native graphics experts. Floating Point parameters allow finite values; the AO applies its SP limits. No electrical 4-20 mA conversion is claimed.',
        steps: [
          { id: 'dv09-ao-1', text: 'Create PLANT_AREA_A, commission CTRL1, add C01 AI and C02 AO, and name/enable LT-1 at C01 CH1 and LY-1 at C02 CH1.', goto: 'hardware' },
          { id: 'dv09-ao-2', text: 'Create AO LEVEL-101 in Explorer, range 0-1000 gal. Alternatively create AO from the Studio I/O palette and Apply AO Scale / Limits: Scale Low 0, High 1000, SP Low 0, SP High 1000, Unit gal.', goto: 'explorer' },
          { id: 'dv09-ao-3', text: 'Open LEVEL-101 in Studio, bind IO_OUT LY-1, and use New Floating Point Input to create CAS_SP with value 500. Drag its CV output pin to AO1 CAS_IN or select CAS_SP as CAS_IN source.', goto: 'studio' },
          { id: 'dv09-ao-4', text: 'Run with target CAS. Confirm actual CAS, SP500 gal, applied OUT50%, and LY-1 signal50%. CAS_SP0 gives0%; CAS_SP1000 gives100%. Out-of-limit finite parameter values are clamped by AO SP limits and report Limited.' },
          { id: 'dv09-ao-5', text: 'Delete the CAS_IN wire: output holds Bad. Reconnect to recover. AUTO uses SP independently of CAS_SP; MAN uses percent output. OOS or a disabled output channel holds the last actual channel signal with Bad.' },
          { id: 'dv09-ao-6', text: 'Create AI LI-101 range0-1000 gal, bind IO_IN LT-1, then configure LT-1 simulated tieback source LY-1 in Physical Network. At CAS_SP500 confirm LI-101 becomes500 on the following input scan. This is simulated percent-to-engineering tieback, not physical feedback.', goto: 'hardware' }
        ]
      },
      {
        id: 'dv09-ao-lifecycle',
        title: 'LEVEL-101 Save, Download and Restart',
        objective: 'Keep saved defaults independent from live values and reproduce the pp169-170 preservation outcomes.',
        note: 'Opt-in standalone AO only, not a physical or whole-controller download. Browser Save persists configuration; simulated NVM and deployed runtime are in-memory. Other module types remain immediately live. Workshop checkmarks are manual, not acceptance-test evidence.',
        steps: [
          { id: 'dv09-life-1', text: 'Finish the LEVEL-101 AO/CAS_SP fixture above. In Studio click Enable Saved Module Lifecycle and accept the held-output warning. Confirm assigned controller CTRL1, IO_OUT LY-1, configured CAS and CAS_SP500. Enrollment holds output until the first Save and Full Download.', goto: 'studio' },
          { id: 'dv09-life-2', text: 'Save Module. Open Download and Cancel: output stays held and no deployment occurs. Open Download again and Confirm Full. Run and verify actual CAS with output50%. Go Online; offline configuration controls must not edit runtime.' },
          { id: 'dv09-life-3', text: 'Go Offline and select Preserve critical block values, then Save. Go Online and set mode AUTO and live CAS_SP555. Confirm Partial Download. MODE remains AUTO, but CAS_SP returns to its saved default500.' },
          { id: 'dv09-life-4', text: 'Repeat using Preserve user-defined and critical block values: set live AUTO/CAS_SP555 before Partial Download. Verify AUTO/555. Repeat using Use configured values: the result must be CAS/500. Saved defaults remain CAS/500 in all three cases.' },
          { id: 'dv09-life-5', text: 'Go Offline. Select module restart restore and CAS_SP parameter restore; Save and Full Download these flags. Go Online, set CAS_SP555, and allow a scan. Cold Restart Module must retain555. Repeat without either flag: it returns to configured500. Saved but undownloaded restore flags must have no effect.' },
          { id: 'dv09-life-6', text: 'After online edits, Upload to Draft and accept replacement. The draft contains live values; saved browser configuration remains unchanged until Save. Go Offline and Load Saved Configuration to recover the previous saved defaults without changing runtime.' },
          { id: 'dv09-life-7', text: 'In Physical Network, simulate CTRL1 power loss and restore inside its cold-restart window; verify the deployed restore flags. Outside that window, commissioning alone cannot reactivate this AO. A fresh Full Download is required.', goto: 'hardware' }
        ]
      },
      {
        id: 'dv09-analog-picture',
        title: 'TANK101 Bounded Entry and Fill Animation',
        objective: 'Enter LEVEL-101 CAS_SP from the operator picture and animate LI-101 using its fetched engineering limits.',
        note: 'This is the pp173-177 functional subset, not a native DeltaV Operate editor or .grf file. Picture Save uses this browser profile. Supported numeric paths cover the course AI PV and standalone AO Floating Point parameters; arbitrary vendor paths and image-only dialog fidelity remain unverified. The tank reuses the approved ClassicTank artwork.',
        steps: [
          { id: 'dv09-pic-1', text: 'Finish the standalone AO and LI-101 tieback fixture first. Open Display Builder and TANK101 in Configure mode. Add a Datalink with Module tag LI-101. Set Source Path AI1/PV.F_CV, leave Numeric Entry off, and Apply Expert.', goto: 'builder' },
          { id: 'dv09-pic-2', text: 'Add a second Datalink, choose LEVEL-101, and set Source Path CAS_SP.F_CV. Check Numeric Entry, leave Fetch Limits unchecked, enter Low0 and High1000, then Apply Expert. This configures display-entry bounds, not an implicit clamp of every module parameter write.' },
          { id: 'dv09-pic-3', text: 'Add Tank Dynamo and Rectangle. Position the rectangle within the tank level column or in its own bounded region. For the rectangle, choose LI-101 and Source Path PV, enable Fill Percentage, Vertical Direction and Fetch Limits from Data Source, then Apply Expert. Foreground/background and positive dimensions are independently configurable.' },
          { id: 'dv09-pic-4', text: 'Save Picture. Switch Configure to Run. Click the CAS_SP value and apply750.5. After output and input scans, verify LY-1 is75.05%, LI-101 is750.5gal and the rectangle is75.05% filled. Entry0 gives0%; entry1000 gives100%. Entry1001 must reject visibly without changing runtime.' },
          { id: 'dv09-pic-5', text: 'Type a different value and Cancel or Escape: no write occurs. Disable LY-1 to verify last-good level holds with Bad; the requested CAS_SP and physical applied output remain separate. Restore the channel to recover.' },
          { id: 'dv09-pic-6', text: 'Load Saved Picture explicitly to recover the applied picture configuration, without writing any live module value. After browser reload, recreate source-module prerequisites before loading. This is local browser configuration, not downloaded controller memory or a vendor graphics file.' },
          { id: 'dv09-pic-7', text: 'In Explorer select LI-101 and assign Primary Control Display TANK101. Assign an independently created picture as Detail Display and Apply Display Assignments. Open the faceplate and use Primary/Detail; each must navigate its actual picture in Run mode. Back/Forward restores the picture name, not just the builder.', goto: 'explorer' }
        ]
      },
      {
        id: 'dv09-analog-dst',
        title: 'LI-101 Input and Analog Channel Signal Paths',
        objective: 'Read LT-1 into LI-101, verify HI950/LO100, and exercise real PID analog output channels.',
        note: 'Use a separate blank training session, not the approved pharma plant. This is an executable subset of DV-09 p172 plus a PID I/O path check; use the LEVEL-101 exercise above for standalone AO/CAS_SP. Manual inputs are engineering units, outputs percent. Explicit simulated analog tiebacks now exist; 4-20 mA/XD_SCALE conversion, templates, assignment and Save/Download/Online remain absent. File → New Blank Project discards that session after confirmation.',
        steps: [
          { id: 'dv09-ai-1', text: 'In the blank training project, create PLANT_AREA_A and commission CTRL1. Add C01 AI and C02 AO. Name/Enable C01 CH1 LT-1, CH2 FT-2 and C02 CH1 LY-1, CH2 FY-2.', goto: 'hardware' },
          { id: 'dv09-ai-2', text: 'In Explorer create AI LI-101, Area PLANT_AREA_A, Unit gal, Min 0, Max 1000. In Configured Alarms set HI 950 and LO 100 and enable both. New AI threshold alarms start disabled.', goto: 'explorer' },
          { id: 'dv09-ai-3', text: 'Open LI-101 in Studio and select IO_IN LT-1. A binding change marks the unsampled input Bad until the scan validates it.', goto: 'studio' },
          { id: 'dv09-ai-4', text: 'In Physical Network, set LT-1 Simulated signal to 725.5 and Set Simulated Input. Run and confirm LI-101 remains 725.5 gal, not a drifting synthetic measurement. At 100 LO is active; at 100.1 it returns. At 949.9 HI is inactive; at 950 HI becomes active.', goto: 'hardware' },
          { id: 'dv09-ai-5', text: 'For a separate PID path fixture, create PID LOOP-101 with range 0-1000 gal. In Studio bind IO_IN FT-2 and IO_OUT LY-1. Set FT-2 engineering signal to 432.1 and verify AI1/PV reads 432.1.', goto: 'studio' },
          { id: 'dv09-ai-6', text: 'Switch LOOP-101 to MAN, allow a scan, and set OUT.CV 63. Verify C02 CH1 signal 63% and AO1 applied output 63%. Disable CH1, command 80%, and confirm physical/AO output holds 63% with Bad rather than following the command.' },
          { id: 'dv09-ai-7', text: 'Enable CH1 to recover. Select the split strategy and bind AO2.IO_OUT FY-2; verify separate channel signals and independent quality. Disconnect AO2.IO_OUT before returning to the simple strategy. Recovery retains the existing splitter balancing time, not an instant jump.' },
          { id: 'dv09-ai-8', text: 'Disable an input to verify held last-good PV and PV BAD alarm. AI1 MAN can substitute its manual value while FIELD_VAL remains Bad. Restore the channel and AUTO to resume physical sampling. Do not treat this as downloaded persistent configuration.' },
          { id: 'dv09-ai-9', text: 'For the p265 filter subset, start FT-2 at 0. Configure C01 CH2 input filter 2.6 seconds; deployed remains 0 until Download Input Filters is confirmed. Step FT-2 to 1000: after 2.6 simulated seconds the filtered channel reaches about632.12, sampled by the module next scan. Configure and transfer 0 to bypass. This session-local filter-only transfer is not a full card download or DeltaV Tune process-test/update.', goto: 'hardware' }
        ]
      },
      {
        id: 'analog',
        title: 'Supplemental Local Analog Indicator',
        objective: 'Create an analog indicator with engineering range.',
        note: 'Local synthetic input exercise; use the LI-101 DST exercise above for a real simulated channel source.',
        steps: [
          { id: 'ai-1', text: 'DeltaV Explorer → ＋ New Module.', goto: 'explorer' },
          { id: 'ai-2', text: 'Type = AI, Tag = TI-301, Unit = degC, Min = 0, Max = 150, Area = REACTOR.' },
          { id: 'ai-3', text: 'Create, then open its faceplate to read the live PV.' }
        ]
      },
      {
        id: 'pid',
        title: 'Creating a Regulatory Loop (FIC-302)',
        objective: 'Create a PID loop and operate/tune it like FIC-102 in the course.',
        steps: [
          { id: 'pid-1', text: 'DeltaV Explorer → ＋ New Module.', goto: 'explorer' },
          { id: 'pid-2', text: 'Type = PID, Tag = FIC-302, Unit = m3/h, Min = 0, Max = 120, Area = FEED.' },
          { id: 'pid-3', text: 'Create, then open the faceplate. On OPER, confirm mode AUTO and set SP = 50.' },
          { id: 'pid-4', text: 'Switch mode to MAN and change Output %; watch PV follow the output.' },
          { id: 'pid-5', text: 'On the TUNE tab set Gain = 1.2 and Reset = 10; return to AUTO and observe control.' }
        ]
      },
      {
        id: 'dst-usage',
        title: 'System DST usage before and after FIC-102',
        objective: 'Count actual per-type referenced channels exactly once through Explorer Licensing Properties.',
        note: 'Read-only requirement/usage reporting. Purchased capacity, substitution allocation/enforcement, vendor license files and physical System ID keys remain unmodeled.',
        steps: [
          { id: 'dst-usage-baseline', text: 'Use the separate course project. In Explorer expand ProfessionalPLUS (simulated) and open Licensing Properties. Named unused LT-1/FT-2/LY-1/FY-2 channels alone allocate0; bound LI-101 LT-1 allocates oneAI. Record AI/AO/DI/DO totals and actual reference details.', goto: 'explorer' },
          { id: 'dst-usage-loop', text: 'Create FIC-102 PID. An unbound module must not change physical usage. Bind FT-2 input and FY-2 output in Control Studio: requirements increase by exactly oneAI and oneAO. Repeat the bindings: totals do not increase again. An enabled/bound AO2 is another output signal, not another PID-object count.', goto: 'studio' },
          { id: 'dst-usage-readers', text: 'Add another input reader or internal condition referencing the same measured input. It does not allocate another physical DST. Inspect the channel detail to see multiple reader module/port references. Unbinding/deleting the final reader releases that signal allocation.' },
          { id: 'dst-usage-quality', text: 'Disable/pull a bound signal: referenced allocation stays, while enabled/installed referenced count decreases. Lost controller service does not delete an allocated channel. Untransferred saved-device drafts/Save do not change current binding totals; Full deployment does.' },
          { id: 'dst-usage-boundary', text: 'Unresolved/wrong-type/duplicate references must show an explicit incomplete report, not successful0 usage. Actual CHARM channels without native DST names are labeled implicit signals. The source permits AO licenses to cover AI requirements; this report neither invents a complete substitution hierarchy nor approves licensed downloads.' }
        ]
      },
      {
        id: 'alarms',
        title: 'Configuring DeltaV Alarms',
        objective: 'Set alarm limits and priorities, then acknowledge an alarm.',
        steps: [
          { id: 'al-1', text: 'DeltaV Explorer → select LIC-101 (or your FIC-302).', goto: 'explorer' },
          { id: 'al-2', text: 'In Configured Alarms, set the HI limit just below the current PV and Priority = WARNING, Enabled.' },
          { id: 'al-3', text: 'Watch the alarm banner show the new WARNING tile (yellow).' },
          { id: 'al-4', text: 'Open the Alarm List and Acknowledge the alarm.', goto: 'alarms' }
        ]
      }
    ]
  },
  {
    module: 'DV-09 · Motor Control',
    workshops: [
      {
        id: 'motor',
        title: 'Creating a Motor Control Module (MTR-301)',
        objective: 'Create a motor module and operate it with interlocks.',
        steps: [
          { id: 'mt-1', text: 'DeltaV Explorer → ＋ New Module, Type = MOTOR, Tag = MTR-301, Area = FEED.', goto: 'explorer' },
          { id: 'mt-2', text: 'Create, then open the faceplate and use START / STOP.' },
          {
            id: 'mt-3',
            text: 'Use Force Interlock and confirm the motor trips to SHUTDOWN/INTERLOCKED. Click Clear Interlock, then RESET to clear the Locked state (Reset Required device option).'
          },
          {
            id: 'mt-4',
            text: 'Enable the Permissive device option and leave Permissive unmet — confirm START is blocked until you Set Permissive.'
          }
        ]
      },
      {
        id: 'motor-external-dst',
        title: 'Independent motor command and external confirmation',
        objective: 'Execute XI-2 / ZX-2 I/O without substituting the command or a timer for running feedback.',
        note: 'Live I/O subset. Native MTR-11_ILOCK template remains incomplete; isolated saved Full device deployment is offered in the following workshop.',
        steps: [
          { id: 'motor-dst-inventory', text: 'Create a commissioned CTLR with a DI card in slot3 and DO card in slot4. Enable channel2 as XI-2 and ZX-2 respectively. Create an unbound MTR-102 MOTOR; stop and confirm it before changing its physical bindings.', goto: 'hardware' },
          { id: 'motor-dst-bind', text: 'Open MTR-102 in Control Studio. Select IO_IN_1 = XI-2 and IO_OUT_1 = ZX-2. Both are required. The Hardware channel properties show the actual owning module/port.', goto: 'studio' },
          { id: 'motor-dst-independent', text: 'Keep XI-2 manual input0. START the motor: ZX-2 becomes1, but running stays false. After its confirmation time, verify FAILED ACTIVE and a FAIL alarm, not fabricated Running. Set the physical simulated XI-2 input1; the next good scan confirms Running.' },
          { id: 'motor-dst-stop', text: 'STOP writes ZX-2 =0 but does not overwrite XI-2 or Running. Set XI-2 =0 to confirm Stopped. Alternatively, explicitly select ZX-2 as XI-2 simulated tieback; it is labeled simulation, not physical wiring.' },
          { id: 'motor-dst-safety', text: 'Test false permissive, interlock and required RESET independently. Disable DI or DO, or lose controller power: verify Bad/held feedback, failed state and alarm. SFC confirmation must not advance on Bad values. Restore real channel/controller service; an injected field fault is not automatically cleared.' }
        ]
      },
      {
        id: 'motor-sustained-condition',
        title: 'Sustained low-level condition and closed-valve trip',
        objective: 'Execute the p230 condition dependencies with exact threshold/time boundaries and actual motor shutdown.',
        note: 'Wired IN1/IN2 and exact quoted DI1/PV_D/AI1/PV expressions execute. The owned two-condition template workshop follows; full native template/property parity remains incomplete.',
        steps: [
          { id: 'motor-cnd-source', text: 'Use good XVSTAT-101 DI feedback and LI-101 AI measured input. Create CND1/CND2 and OR-TRIP function blocks. Wire CND1.IN1 to XVSTAT-101 and CND2.IN1 to LI-101.', goto: 'studio' },
          { id: 'motor-cnd-expression', text: 'In CND1 EXPR enter IN1 = 0 and Apply; set TIME_DURATION0s. In CND2 enter IN1 < 50 and Apply; set TIME_DURATION4s. An unapplied draft never executes. Malformed syntax is rejected with a notification and diagnostic.' },
          { id: 'motor-cnd-wire', text: 'Wire OR-TRIP IN1/IN2 to CND1/CND2; wire the motor INTERLOCK_SOURCE to OR-TRIP. Keep valve feedback open and level50: no low-level trip. At49, verify CND2 OUT0 at3.9s and OUT1 at4.0s, then actual motor shutdown.' },
          { id: 'motor-cnd-recovery', text: 'Raise level above50; the condition clears but Reset Required keeps the motor locked until Reset. With XI-2/ZX-2 bindings and explicit simulated tieback, observe the output drop before actual stopped feedback follows.' },
          { id: 'motor-cnd-quality', text: 'Interrupt low level with a false or Bad/OOS input: elapsed time resets, and recovery requires a new uninterrupted four seconds. Bad/missing interlock sources display Bad - tripped and must not admit a new start. Closed-valve feedback trips through CND1 without the level delay.' }
        ]
      },
      {
        id: 'motor-first-out-bypass',
        title: 'First-out trapping and independent bypass indication',
        objective: 'Record the initial trip cause without conflating current inputs, operator reset or bypass.',
        note: 'Two-input BFI subset, not16-input/BCD or native motor template parity.',
        steps: [
          { id: 'motor-trap-wire', text: 'Wire BFI IN1/IN2 to CND1/CND2 from the sustained-condition workshop. Wire the motor interlock to BFI.OUT_D. Enable ARM_TRAP in Parameter View.', goto: 'studio' },
          { id: 'motor-trap-cause', text: 'Trigger only input1: FIRST_OUT1 and OUT_INT1. Trigger input2 as well: FIRST_OUT remains1 while OUT_INT3 and OUT_D1. After all causes clear, a new input2-only event captures2.' },
          { id: 'motor-trap-reset', text: 'Pulse RESET_IN while tripped. FIRST_OUT clears, but actual trip/OUT_D remains active; no capture rearms until all inputs clear. Resetting trap does not reset the motor lock.' },
          { id: 'motor-trap-bypass', text: 'Create independent OR-BYPASS with IN1=CND1.BYPASS and IN2=CND2.BYPASS. Toggle a CND bypass: indicator becomes1 while the healthy condition is inhibited. Removing bypass requires a fresh delay. Bad input remains Bad and the downstream motor interlock remains fail-safe. Check Restricted Control/lock denial and journal entries.' }
        ]
      },
      {
        id: 'motor-saved-device',
        title: 'Saved motor/valve configuration and Full download',
        objective: 'Separate edited and persisted configuration from deployed runtime and physical command/confirmation.',
        note: 'Full simulated device transfer subset, not full native template parity, Partial download or upload/NVM. Use independent traditional DI/DO. Offline never stops an already-deployed runtime.',
        steps: [
          { id: 'motor-save-enable', text: 'Stop/close the device and confirm both physical channels passive. In Control Studio Parameter View choose Enable Saved Device Lifecycle. The selected device is inhibited until first Save/Full Download; other devices remain live.', goto: 'studio' },
          { id: 'motor-save-draft', text: 'In the offline draft assign commissioned CTLR, input XI-2 and output ZX-2. Set permissive/reset options, confirmation time and actual interlock/permissive/command source tags. Verify live configuration, physical bindings and outputs remain unchanged. A true deployed command source can command active after download.' },
          { id: 'motor-save-persist', text: 'Save Device. Edit confirmation time without saving, then Load Saved Device and confirm replacement: persisted value returns to the draft, runtime remains unchanged. Bad schema/type/source or blocked browser storage must report failure, not success.' },
          { id: 'motor-save-download', text: 'Download Device then Cancel: no transfer. Reopen and Confirm Device Download. Require both channels scanned Good, correctly typed, owned by assigned controller, passive, and no output writer conflict. Successful Full download enters Online and exposes actual deployed DSTs/revision; failures retain last-good runtime.' },
          { id: 'motor-save-confirm', text: 'START with physical DI0: DO energizes, feedback stays false and timeout gives FAILED ACTIVE. Actual DI1 confirms running. Stop and DI0 confirm passive before replacement download. Online draft edits reject; Go Offline permits edits without stopping runtime. Faceplate options show deployed values and direct configuration edits back to Studio.' }
        ]
      },
      {
        id: 'motor-owned-template',
        title: 'MTR-11_ILOCK owned two-condition template and exact source expressions',
        objective: 'Save and deploy the whole owned interlock/first-out/bypass/permissive strategy with its motor.',
        note: 'Modeled two-condition course subset; original8/16-condition palette/library drag-drop/state-mask/all DC-property/Partial-download/NVM parity remains incomplete. The following workshop verifies the exact500/10gal dependencies.',
        steps: [
          { id: 'motor-template-copy', text: 'In Explorer New Module select MOTOR and Library / Motors-2State / MTR-11_ILOCK. Name MTR-102 in the training area. This creates one inhibited motor with owned CND1/CND2/BFI1/OR1/NOT1/AND1, not independent live modules.', goto: 'explorer' },
          { id: 'motor-template-conditions', text: 'Open owned CND1, set EXPR to \'//XVSTAT-101/DI1/PV_D\' = 0 and Apply, TIME_DURATION0. Open CND2 and Apply \'//LI-101/AI1/PV\' < 50, TIME_DURATION4. Qualified sources must exist with correct type. Owning motor button returns to Save/Download; offline edits leave actual deployed blocks unchanged.', goto: 'studio' },
          { id: 'motor-template-permit', text: 'Configure AND1.IN1/IN2 with real start-permissive dependencies, or deliberate training constants (defaults1). AND1 drives permissive independently of NOT1, which maps BFI trip output into the explicit healthy-at1 interlock polarity. Bad always trips; do not invert Bad into permission.' },
          { id: 'motor-template-download', text: 'On owning motor assign commissioned CTLR, XI-2 DI card3channel2 and ZX-2 DO card4channel2; set Reset Required/Permissive. Save then Full Download. Both physical channels must be passive/scanned Good with no writer conflict. All owned configuration transfers together; Online configuration edits reject.' },
          { id: 'motor-template-verify', text: 'With open-valve DI1 and measured level50, no trip. At49, CND2 remains0 at3.9 and becomes1 at4.0; BFI FIRST_OUT2, NOT1 becomes0, motor trips and ZX-2 de-energizes before XI-2 physically confirms stopped. Clear causes and reset motor lock. In Online owned CND2 toggle BYPASS: independent OR1 becomes1; Bad cannot be bypassed. BFI Reset clears trap only, never actual trip or motor lock. Lost controller marks owned outputs Bad without erasing good historical first-out.' }
        ]
      },
      {
        id: 'motor-course-level',
        title: 'Operating MTR-102 at the prescribed 500 and 10 gallons',
        objective: 'Execute p234 through the real saved AO, scaled sampled level, DO/DI valve and downloaded owned motor.',
        note: 'Use a separate blank training project. All tiebacks below are explicit simulator connections, not claims of physical wiring or a fluid-dynamics model. Keep approved equipment colors unchanged.',
        steps: [
          { id: 'motor-course-hardware', text: 'Commission CTLR. Configure AI card1channel1 LT-1, AO card2channel1 LY-1, DI card3channel1 LSO-1 and channel2 XI-2, DO card4channel1 XV-1 and channel2 ZX-2. Enable every channel. Explicitly set LT-1 tieback LY-1, LSO-1 tieback XV-1 and XI-2 tieback ZX-2. Command and feedback remain separate sampled values.', goto: 'hardware' },
          { id: 'motor-course-analog', text: 'Create LI-101 AI with PV_SCALE0-1000gal and IO_IN LT-1. Create LEVEL-101 AO with PV_SCALE0-1000gal, SP_LO_LIM0 and SP_HI_LIM1000. Enable saved lifecycle, add Floating Point CAS_SP500 and connect to CAS_IN. Offline assign CTLR/LY-1 and mode CAS. Save, Full Download, Online. Verify applied LY-1 output50% and LI-101 sampled500gal on the next scan.', goto: 'studio' },
          { id: 'motor-course-discrete', text: 'Create XV-101 DO bound to XV-1 and XVSTAT-101 DI bound to LSO-1, AUTO. Use the preceding owned MTR-102 template/exact quoted CND expressions with duration0/4 and XI-2/ZX-2. Wire AND1.IN1 to XVSTAT-101 and IN2 to deliberate constant1. Save and Full Download the whole motor strategy.' },
          { id: 'motor-course-open', text: 'Energize XV-101 using its actual DO command. Wait for the separately sampled XVSTAT feedback1 and good level500. Clear any initial motor lock with RESET_D and first-out history separately. START MTR-102 from the real faceplate: ZX-2 energizes first; Running becomes true only after XI-2 confirms. STOP/START must operate correctly at500gal.' },
          { id: 'motor-course-close', text: 'De-energize XV-101. The following good closed DI scan makes CND1 trip and BFI FIRST_OUT1, NOT1 healthy output0, denied permissive and ZX-2 output0. Running is not fabricated Stopped in the command scan; XI-2 must confirm. Reopen valve: trip clears, but Reset Required retains the motor lock and blocks Start. RESET_D permits a new Start.' },
          { id: 'motor-course-low', text: 'While the valve is open and motor confirmed Running, enter CAS_SP10 on actual LEVEL-101 Parameter View. Verify LY-1 output1% and sampled LI-10110gal. CND2 remains0 through3.9 uninterrupted good seconds and becomes1 at4.0; FIRST_OUT2 and actual motor output shutdown follow. Raise CAS_SP500: condition clears but history and motor lock remain until their separate resets.' },
          { id: 'motor-course-boundaries', text: 'CAS_SP50 means5%/50gal and must not trip low level. Disable LT-1 or lose its controller: held10/500 is Bad, not a valid permission; the motor trips fail-safe. Restore Good while low: timing starts fresh and must run another continuous four seconds. Never bypass Bad to manufacture permission.' }
        ]
      },
      {
        id: 'valve-course-descriptors',
        title: 'XV-OPTION: Flush/Hold and separately sampled Flushing/Holding',
        objective: 'Execute p235 with four deployed Named Set descriptors and actual card3channel4/card4channel4 device I/O.',
        note: 'Explicit command/feedback descriptor mappings, not native state-mask or template-dialog parity. Raw SP_D/PV_D stay0/1; Named Set entry numbers are descriptor identities.',
        steps: [
          { id: 'valve-descriptor-setup', text: 'Explorer Setup > Named Sets: create NS-XV with four visible entries: Hold0 selectable, Flush1 selectable, Holding2 nonselectable, Flushing3 nonselectable. Save Properties. Transfer Changed Setup Data independently to CTLR and the workstation; configured definitions alone never become online labels.', goto: 'explorer' },
          { id: 'valve-descriptor-io', text: 'Configure commissioned CTLR DI card3channel4 XI-4 and DO card4channel4 ZX-4, enabled. Create XV-OPTION VALVE; its Control Studio DC block uses separate confirmation and command. Use manual XI-4 input0 initially or an explicitly labeled simulated tieback to ZX-4.', goto: 'hardware' },
          { id: 'valve-descriptor-configure', text: 'Open XV-OPTION Studio, enable saved device lifecycle while physically passive, assign CTLR/XI-4/ZX-4. In the offline descriptor draft select NS-XV; map passiveCommand0, activeCommand1, passiveFeedback2, activeFeedback3. Apply Device Descriptors applies only the complete draft; uncommitted dropdown edits do nothing. Save Device and Full Download while both channels scanned Good/passive.', goto: 'studio' },
          { id: 'valve-descriptor-operate', text: 'Open the actual valve faceplate: buttons Flush/Hold, Command Hold and Feedback Holding. Flush writes actual SP_D1 and ZX-4 output1, but feedback stays Holding until good XI-4 input1 is sampled. Hold writes SP_D0/output0 while feedback remains Flushing until separate input0 confirms. Do not replace feedback with the requested command.' },
          { id: 'valve-descriptor-recovery', text: 'Missing/untransferred descriptor setup is explicitly Bad and active operator entry is denied; safe passive entry remains available with Control permission. Bad physical feedback holds its actual value/descriptor with separate Bad quality, never fictitious success. Workstation lock denies both command directions. Offline mappings remain isolated; persistent Load restores saved draft and Download applies changes. Clearing mappings returns normal default labels only after Save/Full deployment. Existing equipment shapes/colors remain unchanged.' }
        ]
      }
    ]
  },
  {
    module: 'DV-09 · Sequencing (SFC)',
    workshops: [
      {
        id: 'sfc-t101',
        title: 'Adapted feed startup sample',
        objective: 'Run the built-in feed sample; this is not the exact course-tag workshop.',
        steps: [
          { id: 'sfc-1', text: 'Open SFC Charts and select STARTUP-T101.', goto: 'sfc' },
          { id: 'sfc-2', text: 'Review the steps: OPEN BLOCK VALVE → SET FLOW 50 → START PUMP, each with a transition.' },
          { id: 'sfc-3', text: 'Click ▶ Run and watch the active step advance as each transition is met.' },
          { id: 'sfc-4', text: 'When the last transition clears, the chart status becomes COMPLETE. RUN from COMPLETE starts a fresh run. STOP/ABORT currently reset this adapted routine; native controlled-stop/abort sequences are not yet implemented.' },
          { id: 'sfc-qualifiers', text: 'Qualifier timing subset: name a stored action and use SD14 in a step that exits after10s. It remains pending after exit, executes at14s, and R in a later step stops that named action without inverting its last assignment. DS14 in the10s step cancels instead. P fires once after its time/structured condition; SL can expire across steps. Named Set assignments share these semantics: N repeatedly writes the prompt; it is not silently converted into a one-shot action. Return/selective routes and disjoint parallel legs with all-predecessor joins are supported; arbitrary functions and nested/selective parallel legs remain unavailable.', goto: 'sfc' },
          { id: 'sfc-properties', text: 'Editing subset: select a step and right-click its Action window -> Add. Right-click an action or transition -> Properties. Expression Assistant opens the supported-path Browser; edit a draft, Cancel to retain its original, or OK to validate/apply. Check validates the supported algorithm without executing it. Opt-in lifecycle provides controller assignment, Save/Download and Online execution. Configured Named Set expressions are supported, but arbitrary functions, native Confirm tab and graph workflows remain unavailable; this is not completion of the exact course workshop.', goto: 'sfc' },
          { id: 'sfc-message', text: 'MESSAGE prerequisite: in Explorer Setup > Named Sets, configure NS-T101 with STARTUP=1 visible/selectable and SELECT SEQUENCE=255 visible/nonselectable. Transfer Changed Setup Data separately to the controller and workstation. Enable SFC lifecycle, Add Parameter MESSAGE of type Named Set, bind NS-T101 and default255. Properties/Browser support \'MESSAGE\' := \'NS-T101:SELECT SEQUENCE\' and \'MESSAGE\' = \'NS-T101:STARTUP\'. Save and Download to the assigned controller. On a picture datalink choose the SFC, MESSAGE.CV and Named Set Data Entry. Run offers STARTUP but not the reserved prompt. The next workshop uses the course-tag feedback/dependency subset; native branch editing and external motor/DC template feedback remain unsupported.', goto: 'sfc' }
        ]
      },
      {
        id: 'sfc-course-paths',
        title: 'Course-tag startup / shutdown dependencies',
        objective: 'Configure and operate the verified pp291/294 dependency subset, not a native template/graph parity claim.',
        steps: [
          { id: 'course-sfc-io', text: 'Use a separate blank project so the sample XV-101 VALVE is not mistaken for the course DO. Create PLANT_AREA_A, commission CTLR and configure traditional AI slot1/FT-2 channel2, AO slot2/FY-2 channel2, DI slot3/LSO-1 channel1 and DO slot4/XV-1 channel1. Enable the channels. Configure LSO-1 simulated tieback to XV-1; this is an explicit simulator connection, not physical wiring.', goto: 'hardware' },
          { id: 'course-sfc-modules', text: 'Create XV-101 DO and XVSTAT-101 DI; in Control Studio bind IO_OUT to XV-1 and IO_IN to LSO-1, both AUTO. Create FIC-102 PID using Explorer -> New Control Module -> Module template -> Library / Regulatory Control / PID_LOOP (DV-09). Confirm range0-100 GPM, GAIN0.5, RESET3s/repeat, RATE0, reverse acting, IO_OPTS INCREASE_TO_OPEN and LO10/HI90; the template assigns TANK101 as Primary. In Control Studio bind AI input FT-2 and AO output FY-2; use MANUAL INPUT on FT-2 to supply measured flow and verify the applied output. Under Parameters -> SAVED CONFIGURATION, enable the opt-in PID_LOOP lifecycle, assign the commissioned CTLR, verify FT-2/FY-2, Save Module, Full Download and Go Online. Save persists to this browser profile and Download/Online target the simulator only; no physical controller communication is performed. Create MTR-102 MOTOR; select IO_IN_1 XI-2 and IO_OUT_1 ZX-2 for independent external feedback/output. Configure manual feedback or an explicitly simulated tieback. For isolated saved configuration follow the saved device workshop; native DC templates remain incomplete.', goto: 'studio' },
          { id: 'course-sfc-setup', text: 'Configure NS-T101 STARTUP=1 and SHUTDOWN=2 visible/selectable, SELECT SEQUENCE=255 visible/nonselectable. Transfer Changed Setup Data separately to CTLR and the workstation. Explorer: right-click PLANT_AREA_A -> New -> Control Module, choose Algorithm Type Sequential Function Chart, name SFC-T101 and Create. The exact named chart opens empty/Offline with Save/Download lifecycle already enabled. Add Parameter MESSAGE bound to NS-T101/default255. Create HOLD_SFC, OPEN_BLK_VLV, SET_FLOW_RATE, START_PUMP, STOP_PUMP, CLOSE_BLK_VLV, CLOSE_FLOW_VLV and END_SEQUENCE steps.', goto: 'explorer' },
          { id: 'course-sfc-prompt', text: 'HOLD_SFC action Properties: \'MESSAGE\' := \'NS-T101:SELECT SEQUENCE\', qualifier P for a one-shot simulator prompt. N repeats every scan and must not be silently treated as P. Transition Properties: \'MESSAGE\' = \'NS-T101:STARTUP\', explicit OPEN_BLK_VLV destination. Add alternate \'MESSAGE\' = \'NS-T101:SHUTDOWN\' to STOP_PUMP. Only the selected path activates; these Properties are not the native graph palette.' },
          { id: 'course-sfc-start', text: 'OPEN_BLK_VLV assigns \'^/XV-101/DO1/SP_D.CV\' := 1; its transition uses \'^/XVSTAT-101/DI1/PV_D.CV\' = 1. SET_FLOW_RATE assigns FIC-102/PID1/MODE.TARGET AUTO and SP.CV50, then waits for PID1/OUT.CV > 30. START_PUMP assigns MTR-102/DC1/OUT_D.CV1, waits for DC1/PV_D.CV1, then routes to END_SEQUENCE. Enter supported quoted paths through Properties/Browser; command and feedback are different values.' },
          { id: 'course-sfc-stop', text: 'For the p294 figure order: STOP_PUMP assigns MTR-102/DC1/OUT_D.CV0 and waits for DC1/PV_D.CV0. CLOSE_BLK_VLV assigns XV-101/DO1/SP_D.CV0 and waits for XVSTAT-101/DI1/PV_D.CV0. CLOSE_FLOW_VLV assigns FIC-102/PID1/MODE.TARGET MAN and OUT.CV0, waits for OUT.CV < 2. END_SEQUENCE TRUE returns to HOLD_SFC. The source-text ordering differs; this fixture does not certify both.' },
          { id: 'course-sfc-transfer', text: 'Check, Module Properties -> CTLR, Save, Download -> confirm, Go Online, RUN. Allow the prompt action to execute. In a picture, bind a datalink to SFC-T101/MESSAGE.CV with Named Set entry, open Run mode and choose STARTUP. Verify sampled valve feedback precedes50 GPM, output>30 precedes pump start, and prompt255 returns. Select SHUTDOWN, then STARTUP again; confirm the prescribed dependent steps and real running state each cycle.', goto: 'builder' },
          { id: 'course-sfc-fault', text: 'With the chart waiting at HOLD_SFC, disable the XV-1 output channel and select STARTUP. OPEN_BLK_VLV must wait: requested ON is not applied state, the separate DI is Bad, and the pump cannot start. Re-enable the channel; output and then DI sample recover before continuation. Transition Properties also compares PID1/MODE.ACTUAL (AO uses AO1); it never substitutes requested MODE.TARGET. Native graph/palette, nested parallel legs, full New/template dialogs, SFC description/equipment membership, restart and the full course are still incomplete.' }
        ]
      },
      {
        id: 'sfc-parallel',
        title: 'Parallel divergence and synchronization subset',
        objective: 'Execute independent branches concurrently and verify an all-predecessor join, not sequential stand-ins.',
        steps: [
          { id: 'parallel-build', text: 'Create a managed SFC with FORK, LEG_A, LEG_B and JOIN. Configure LEG_A timer0.2s -> JOIN, LEG_B timer0.5s -> JOIN. Give each branch a pulse assignment to a different real module output; do not share writes or action/reset identities across concurrent legs. JOIN may TRUE-terminate or return to FORK.', goto: 'sfc' },
          { id: 'parallel-properties', text: 'FORK Transition Properties: TRUE, enable Activate parallel paths, select LEG_A and LEG_B, choose JOIN as synchronization join. Cancel must retain both fork and join; OK commits them atomically. Check validates independent acyclic paths, exact predecessor lists and writes. Nested/selective legs, bypasses and loops before the join are rejected rather than flattened.' },
          { id: 'parallel-run', text: 'Assign controller, Save, Download -> confirm, Online, RUN. First fork scan activates both steps and their pulse actions. After0.2s LEG_A leaves and is listed as arrived at JOIN; LEG_B stays active. The JOIN action must not execute until LEG_B reaches0.5s. The chart highlights all actual active steps and shows separate timers/arrivals; array ordering does not label another path COMPLETE.' },
          { id: 'parallel-hold', text: 'HOLD freezes all active timers and arrival tokens; RESTART resumes the same paths. Controller unavailability also freezes them. Reset clears active paths, pending arrivals and action runtime; a fresh RUN starts at FORK. A return after JOIN re-arms the next cycle. Stored branch timers continue once per scan after branch exit, not once for each active path.' },
          { id: 'parallel-boundary', text: 'This is a functional disjoint fork/join execution subset. Native parallel connector/palette/layout, nested/conditional parallel graphs and full course parity remain incomplete. Existing legacy linear/selective charts retain their original execution model.' }
        ]
      },
      {
        id: 'sfc-boolean',
        title: 'Boolean parameter action lifecycle',
        objective: 'Distinguish a qualified Boolean reference action from a one-way assignment.',
        steps: [
          { id: 'boolean-parameter', text: 'Create a managed SFC with an initial ACTIVE_TEST step waiting one second, followed by a WAIT_TEST step waiting longer. Add Parameter -> Type Boolean -> ACTIVE -> FALSE. Cancel must create nothing; OK creates only a draft parameter.', goto: 'sfc' },
          { id: 'boolean-action', text: 'Select ACTIVE_TEST -> + action -> Type Boolean parameter -> name RUNFLAG -> qualifier N. Expression Assistant lists the local ACTIVE.CV reference, not a module output assignment. Cancel changes nothing; OK stores the Boolean reference. Transition Properties may compare ACTIVE.CV = TRUE or FALSE (quoted local path).' },
          { id: 'boolean-online', text: 'Check, assign controller, Save, Download -> confirm, Online, RUN. ACTIVE must remain FALSE until the action executes, then become TRUE during ACTIVE_TEST and FALSE when that step leaves. HOLD freezes the flag and timer; RESTART continues. STOP clears action activation without changing the saved default or unrelated parameters.' },
          { id: 'boolean-qualifiers', text: 'Reset/Offline and use Properties to compare P/D/L/S/SD/DS/SL. P drives one scan after its delay, D waits while its step is active, L expires, stored actions survive departure, pending DS cancels but SD continues and SL expires after departure. Add an R action named RUNFLAG to reset a stored activation. Do not substitute a TRUE assignment that stays latched after expiry.' },
          { id: 'boolean-boundary', text: 'Boolean defaults and references are saved/deployed independently of Named Sets. Named Set operator entry cannot write them. Native Confirm/full expression language and general non-Boolean function-block activation remain unsupported; local ALARM-block monitors are covered by the timeout workshop. This is not completion of the whole course.' }
        ]
      },
      {
        id: 'sfc-timed-alarm',
        title: 'Non-Boolean block / shared timeout alarm subset',
        objective: 'Configure and execute the block/type/alarm dependency chain; verify a real operator alarm strictly above30 seconds.',
        steps: [
          { id: 'sfc-alarm-config', text: 'In a managed Offline SFC, add custom Alarm Type TIMEOUT with a description/priority. Add Function Block TIMECHK (ALARM, action time >30 seconds), then SFC Alarm TIME_ALM -> TIMEOUT -> TIMECHK, Enabled. Cancel changes nothing. These types are local saved/deployed SFC configuration, not native global Alarm Type setup.', goto: 'sfc' },
          { id: 'sfc-alarm-action', text: 'Initial step -> Add Action -> Type Non-Boolean function block -> name TIME_MONITOR -> qualifier S -> Expression Assistant -> local TIMECHK reference. OK must store a block reference, not an output assignment. S continues one clock across later steps until an R action named TIME_MONITOR, reset or termination. Each block requires one owning non-reset action.' },
          { id: 'sfc-alarm-boundary', text: 'Check, assign controller, Save, Download -> confirm, Online, RUN. With the routine still waiting, TIMECHK OUT must remain0 at30 seconds and become1 only above30 (next0.1s scan). No block action or disabled alarm must never fabricate a timeout. HOLD/controller loss freezes monitor clock/output; RESTART resumes.' },
          { id: 'sfc-alarm-operator', text: 'Open real Alarm List: TIME_ALM shows TIMEOUT, configured priority and elapsed seconds. Shelve/Unshelve/ACK use the shared alarm lifecycle/journal. Click the module link to open this exact SFC. STOP/reset clears the block; next scan returns the alarm to normal, retaining it if unacknowledged and clearing it after ACK. Repeat execution; the alarm must re-trigger, journal a new edge and re-sound the horn.' },
          { id: 'sfc-alarm-boundary-note', text: 'This closes the functional local timeout dependency subset. Global Alarm Type/Changed Setup Data, arbitrary block palettes/wiring, full expression language and native motor template/I/O parity remain incomplete; the level/reset workshop covers its modeled functional chain. Do not mark the course finished.' }
        ]
      },
      {
        id: 'sfc-level-reset',
        title: 'Startup level / device reset / waiting messages',
        objective: 'Wait for a valid sufficient level, reset only the device latch and wait for real running confirmation while publishing MESSAGE status.',
        steps: [
          { id: 'sfc-wait-status', text: 'Extend the MESSAGE Named Set with visible but nonselectable waiting states, for example WAIT LEVEL/WAIT MOTOR. Add pulse MESSAGE assignments in the corresponding waiting steps. Transfer changed Named Sets to controller/workstation; these states must display but never be offered as operator commands.', goto: 'sfc' },
          { id: 'sfc-level-gate', text: 'Before motor start, author a LI-101/AI1/PV.CV transition with a chosen sufficient threshold, for example >100. 100 is an example, not a prescribed optional-exercise value. Good100 must keep the sequence waiting; Bad150 must not release it. Correct sampled150 must release it.' },
          { id: 'sfc-reset-action', text: "Next step -> Add Action -> Assignment -> P ->0s -> Expression Assistant -> MTR-102 -> '^/MTR-102/DC1/RESET_D.CV' := 1. Cancel changes nothing; OK, Save, Download -> confirm, Online. The device lock stays intact until qualified execution. RESET_D clears only the lock, not command, fault, interlock or permissive. :=0 does not reset; expiry does not write an inverse." },
          { id: 'sfc-confirm-running', text: 'Separate command/confirmation step: command MTR-102 ON and wait for its actual running feedback. A remaining interlock, false permissive or failed confirmation must keep WAIT MOTOR. HOLD/controller loss freezes the chain. Observe WAIT LEVEL -> WAIT MOTOR -> READY -> SELECT SEQUENCE on the real operator-picture MESSAGE datalink after STARTUP entry.' },
          { id: 'sfc-level-reset-boundary', text: 'This verifies the modeled functional optional chain. External XI-2/ZX-2 I/O, live permissive wiring, two-input first-out/bypass and saved Full device deployment are available separately. Native MTR-11_ILOCK ownership, Partial device download/upload/NVM and exact native dialogs remain incomplete; do not claim native motor or full DV-09 certification.' }
        ]
      },
      {
        id: 'sfc-shutdown',
        title: 'Adapted feed shutdown sample',
        objective: 'Create and run a shutdown sequence using steps, actions and transitions.',
        steps: [
          { id: 'sd-1', text: 'In SFC Charts, type SHUTDOWN-T101 and click Create.', goto: 'sfc' },
          { id: 'sd-2', text: '+ Add Step "STOP PUMP": add action motor P-101 STOP; transition P-101 STOPPED.' },
          { id: 'sd-3', text: '+ Add Step "FLOW TO MAN": actions FIC-101 mode MAN and FIC-101 OUT = 0; transition FIC-101.OUT < 2.' },
          { id: 'sd-4', text: '+ Add Step "CLOSE VALVE": action valve XV-101 CLOSE; transition XV-101 CLOSED.' },
          { id: 'sd-5', text: 'Click ▶ Run and verify the sequence drives the plant to a safe state.' }
        ]
      }
    ]
  },
  {
    module: 'Batch Tutorial · ISA-88',
    workshops: [
      {
        id: 'batch',
        title: 'Running a Batch (REACT_A)',
        objective: 'Execute a recipe through its phases on the reactor unit.',
        steps: [
          { id: 'b-1', text: 'Open the Batch Operator interface.', goto: 'batch' },
          { id: 'b-2', text: 'Press START. The CHARGE phase runs, then HEAT, REACT (soak), and DISCHARGE.' },
          { id: 'b-3', text: 'While running, try HOLD then RESTART; watch the phase state change.' },
          { id: 'b-4', text: 'Let the batch finish (status COMPLETE) or ABORT, then RESET to run again.' }
        ]
      },
      {
        id: 'phase-logic',
        title: 'Editing Phase Logic (a Phase Class Module is an SFC)',
        objective: 'View and modify a phase\'s underlying step/action/transition logic.',
        note:
          'A DeltaV Phase Class Module\'s logic is implemented as an SFC. BatchLive\'s phases use the exact same step/action/transition engine as the SFC Charts display, so what you learn there applies here directly.',
        steps: [
          { id: 'pl-1', text: 'Open the Batch Operator interface (status should be READY so logic is editable).', goto: 'batch' },
          { id: 'pl-2', text: 'Click the CHARGE row in the Procedure panel — the Phase Logic editor opens below.' },
          { id: 'pl-3', text: 'Review step OPEN_FEED\'s 4 actions (HS-201 ON, P-201 STOP, XV-101 OPEN, P-101 START) and its transition (LIC-201.PV >= 80).' },
          { id: 'pl-4', text: 'Click + action and add one, e.g. a second valve OPEN; or change the transition value and watch it take effect on the next run.' },
          { id: 'pl-5', text: 'Press START on the batch, then click a phase again — the editor shows read-only text because logic can\'t change while the batch is active.' },
          { id: 'pl-6', text: 'Press RESET, re-open the phase and confirm it is editable again.' }
        ]
      }
    ]
  },
  {
    module: 'DV-09 · System / Infrastructure',
    workshops: [
      {
        id: 'infra',
        title: 'Controller Commissioning, Auto-sense & Cold Restart',
        objective: 'Identify and commission a controller, discover configured I/O, and verify cold-restart behavior.',
        note:
          'This workshop follows the controller commissioning objectives in DeltaV Training 7009. Controller state, redundancy, I/O discovery, identify indication, and cold-restart eligibility are simulated locally; the displayed 192.0.2.x addresses are documentation-only and no physical network is contacted. The course’s 2001 system-capacity and license tables are not enforced by this single-station simulator. Actual controller downloads, traditional card hardware, fieldbus wiring, and host-level database export still require the real DeltaV environment.',
        steps: [
          { id: 'infra-1', text: 'Add a decommissioned controller named CTLR-02. Click Identify while it is decommissioned; verify the flashing indicator, then stop it.', goto: 'hardware' },
          { id: 'infra-2', text: 'Enable controller redundancy and control-network redundancy for CTLR-02, set Cold Restart to 5 minutes, and apply the properties.' },
          { id: 'infra-3', text: 'Commission CTLR-02. Verify Primary ACTIVE / Secondary STANDBY and that a simulated control-network address is assigned.' },
          { id: 'infra-4', text: 'Auto-sense CTLR-01 and verify its existing I/O scan reports CIOC-01, three baseplates, and 18 installed channels.' },
          { id: 'infra-5', text: 'Auto-sense CTLR-02; it has no assigned carriers, so the scan correctly reports zero detected channels.' },
          { id: 'infra-6', text: 'Decommission and recommission CTLR-02 to observe its inactive/active state transition and retained network address.' },
          { id: 'infra-7', text: 'On CTLR-01, simulate Power Loss and immediately click Restore Power. Verify the cold restart succeeds and bound I/O returns to service.' },
          { id: 'infra-8', text: 'Set CTLR-01 Cold Restart to 0, apply, and repeat Power Loss / Restore Power. The controller remains decommissioned and requires commissioning before I/O returns.' },
          { id: 'infra-9', text: 'Restore CTLR-01 Cold Restart to 5 minutes, apply, then Commission it to return the controller and bound I/O to service.' },
          { id: 'infra-10', text: 'Log on as OperatorA and confirm Identify/Auto-sense/Power Loss require the Diagnostic key, commissioning requires Can Download, property changes require Can Configure, and adding a controller requires System Admin.' }
        ]
      }
    ]
  },
  {
    module: 'DV-09 · DeltaV Security',
    workshops: [
      {
        id: 'security',
        title: 'Defining Users (Locks & Keys)',
        objective: 'Create users with restricted privileges and verify that Locks & Keys actually block operator actions.',
        note:
          'BatchLive starts logged on as admin (password admin123), who holds every Lock & Key, so nothing is restricted by default. Use Utilities → User Manager to create/edit users, and the 🔒 button in the top bar (FlexLock) to switch who is logged on.',
        steps: [
          { id: 'sec-1', text: 'Open Utilities → User Manager.', goto: 'users' },
          {
            id: 'sec-2',
            text: 'Select OperatorA (seeded with only Control, Alarms, Batch Operate) and review its Locks & Keys.'
          },
          {
            id: 'sec-3',
            text: 'Click 🔒 Lock Workstation in the top bar, then log on as OperatorA / operatora.'
          },
          {
            id: 'sec-4',
            text: 'Open any PID faceplate and try the Tune tab — Gain/Reset/Rate are blocked ("Access Denied… requires the Tuning key") because OperatorA lacks Tuning.'
          },
          {
            id: 'sec-5',
            text: 'Confirm SP/Mode/START/STOP still work for OperatorA (Control key), then Lock Workstation and log back on as admin.'
          },
          {
            id: 'sec-6',
            text: 'Back in User Manager, grant OperatorA the Tuning key and verify tuning now works after switching users again.'
          }
        ]
      }
    ]
  }
]
