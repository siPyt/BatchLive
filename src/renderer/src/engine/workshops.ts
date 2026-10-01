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
    module: 'DV-09 · Plant Areas & Control Modules',
    workshops: [
      {
        id: 'areas',
        title: 'Defining Plant Areas',
        objective: 'Review the process-cell area hierarchy used to organise modules.',
        steps: [
          { id: 'areas-1', text: 'Open DeltaV Explorer.', goto: 'explorer' },
          { id: 'areas-2', text: 'Expand REACTOR_CELL and note the FEED, REACTOR and PRODUCT areas.' },
          { id: 'areas-3', text: 'Expand an area and observe its control modules grouped underneath.' }
        ]
      },
      {
        id: 'xv101',
        title: 'Creating Module XV-301 (Discrete Output / On-off Valve)',
        objective: 'Define a new discrete output (valve) control module and operate it.',
        steps: [
          { id: 'xv-1', text: 'In DeltaV Explorer, click ＋ New Module.', goto: 'explorer' },
          { id: 'xv-2', text: 'Set Type = VALVE (on/off), Tag = XV-301, Description = TEST VALVE, Area = FEED.' },
          { id: 'xv-3', text: 'Click Create. XV-301 appears in the FEED area.' },
          { id: 'xv-4', text: 'Select XV-301 and click Faceplate, then use OPEN / CLOSE to command it.' },
          { id: 'xv-5', text: 'Verify the state changes between OPEN and CLOSED (and try Force Interlock).' }
        ]
      },
      {
        id: 'xvstat',
        title: 'Creating Module XVSTAT-301 (Discrete Input)',
        objective: 'Define a discrete input used to monitor a device status.',
        steps: [
          { id: 'xvs-1', text: 'In DeltaV Explorer, click ＋ New Module.', goto: 'explorer' },
          { id: 'xvs-2', text: 'Set Type = DI (Discrete Input), Tag = XVSTAT-301, Area = FEED.' },
          { id: 'xvs-3', text: 'Click Create and open its faceplate to view the status.' }
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
        id: 'analog',
        title: 'Creating an Analog Module (AI)',
        objective: 'Create an analog indicator with engineering range.',
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
          { id: 'mt-3', text: 'Use Force Interlock and confirm the motor cannot start; then Reset Interlock.' }
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
          { id: 'sfc-4', text: 'When the last transition clears, the chart status becomes COMPLETE. Use ⟲ Reset to rerun.' }
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
      }
    ]
  },
  {
    module: 'DV-09 · System / Infrastructure',
    workshops: [
      {
        id: 'infra',
        title: 'Commissioning, Downloads, I/O, Fieldbus, Users, Export',
        objective: 'Understand the workshops that require real DeltaV hardware and host software.',
        note:
          'These DV-09 workshops configure physical infrastructure (controller commissioning and downloads, Traditional/CHARM DSTs, Fieldbus segments) and host administration (Windows users, FHX export, electronic signatures). BatchLive is an offline operator/engineering simulator with no controllers or DeltaV database, so these steps have no literal equivalent. Everything they lead to — live modules, loops, alarms, graphics, SFCs and batches — is already running here without a download.',
        steps: [
          { id: 'inf-1', text: 'Read the note above: these steps are informational in BatchLive (no physical hardware/host).' }
        ]
      }
    ]
  }
]
