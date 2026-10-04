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
        id: 'dv09-standalone-ao',
        title: 'LEVEL-101 Standalone AO and CAS_SP',
        objective: 'Build the actual AO/CAS_SP path and verify applied channel output with a simulated LI-101 tieback.',
        note: 'Use a separate blank training session. This is the executable AO/signal subset of pp164-168 and pp173-178, not the complete workshop. Standalone AO now offers the opt-in saved lifecycle in the next exercise. Native properties/templates, picture assignment and picture-level bounded data entry remain absent. Floating Point parameters allow finite values; the AO applies its SP limits. No electrical 4-20 mA conversion is claimed.',
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
      }
    ]
  },
  {
    module: 'DV-09 · Sequencing (SFC)',
    workshops: [
      {
        id: 'sfc-t101',
        title: 'Using SFC-T101 (Startup)',
        objective: 'Run a sequential function chart that starts up the feed system.',
        steps: [
          { id: 'sfc-1', text: 'Open SFC Charts and select STARTUP-T101.', goto: 'sfc' },
          { id: 'sfc-2', text: 'Review the steps: OPEN BLOCK VALVE → SET FLOW 50 → START PUMP, each with a transition.' },
          { id: 'sfc-3', text: 'Click ▶ Run and watch the active step advance as each transition is met.' },
          { id: 'sfc-4', text: 'When the last transition clears, the chart status becomes COMPLETE. RUN from COMPLETE starts a fresh run. STOP/ABORT currently reset this adapted routine; native controlled-stop/abort sequences are not yet implemented.' },
          { id: 'sfc-qualifiers', text: 'Qualifier timing subset: name a stored action and use SD14 in a step that exits after10s. It remains pending after exit, executes at14s, and R in a later step stops that named action without inverting its last assignment. DS14 in the10s step cancels instead. P fires once after its time/structured condition; SL can expire across steps. Named Set assignments share these semantics: N repeatedly writes the prompt; it is not silently converted into a one-shot action. Arbitrary expressions and graph routing remain unavailable.', goto: 'sfc' },
          { id: 'sfc-properties', text: 'Editing subset: select a step and right-click its Action window -> Add. Right-click an action or transition -> Properties. Expression Assistant opens the supported-path Browser; edit a draft, Cancel to retain its original, or OK to validate/apply. Check validates the supported algorithm without executing it. Opt-in lifecycle provides controller assignment, Save/Download and Online execution. Configured Named Set expressions are supported, but arbitrary functions, native Confirm tab and graph workflows remain unavailable; this is not completion of the exact course workshop.', goto: 'sfc' },
          { id: 'sfc-message', text: 'MESSAGE prerequisite: in Explorer Setup > Named Sets, configure NS-T101 with STARTUP=1 visible/selectable and SELECT SEQUENCE=255 visible/nonselectable. Transfer Changed Setup Data separately to the controller and workstation. Enable SFC lifecycle, Add Parameter MESSAGE of type Named Set, bind NS-T101 and default255. Properties/Browser support \'MESSAGE\' := \'NS-T101:SELECT SEQUENCE\' and \'MESSAGE\' = \'NS-T101:STARTUP\'. Save and Download to the assigned controller. On a picture datalink choose the SFC, MESSAGE.CV and Named Set Data Entry. Run offers STARTUP but not the reserved prompt. The original startup loop, exact FIC-102/MTR-102 bindings and selective shutdown graph are not yet implemented.', goto: 'sfc' }
        ]
      },
      {
        id: 'sfc-shutdown',
        title: 'Startup & Shutdown (build your own SFC)',
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
