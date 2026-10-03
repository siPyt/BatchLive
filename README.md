# BatchLive (BL)

An offline **operator HMI sandbox** that recreates the look and feel of an Emerson **DeltaV Live** station — process graphics, control-module faceplates, an alarm banner/summary, live trends, and a running process-simulation engine — so you can safely experiment, train, and prototype operator workflows.

> BatchLive is an independent educational simulator. It is **not** affiliated with or endorsed by Emerson, and ships no DeltaV software.

![BatchLive icon](build/icon.png)

## Features

- **Live process simulation** — a continuous reactor train (feed → reactor → product) with tank hydraulics, temperature/pressure dynamics, and a classic cascade loop (feed-tank level → feed flow).
- **PID faceplates** — PV/SP/OUT bargraphs, MAN/AUTO/CAS mode switching, setpoint & output control, and a tuning tab (gain / reset / rate).
- **Device faceplates** — motors (start/stop, interlock, fault injection, runtime), on/off valves, analog indicators, and discrete I/O.
- **Alarm system** — Critical / Warning / Advisory priorities, blinking unacknowledged banner tiles, acknowledge-per-point or acknowledge-all, and a sortable/filterable alarm list.
- **Process graphics** — interactive SVG tanks, pumps, valves and piping with live dynamos; click any element to open its faceplate.
- **Classic equipment symbols** — compact centrifugal pumps, blue-framed isolation valves, unboxed hand valves and dome-actuated control valves based on the WFI reference display. Running/open equipment is green; stopped/closed equipment is black. Pump/isolation-valve feedback and applied analog actuation drive the colors, not unapplied commands. WFI reference captions are aliases for the simulator's existing modules; tooltips identify the underlying tag. Unbound valves are reference-only symbols, not simulated controls.
- **Historian trends** — multi-pen real-time charts with selectable pens and time windows.
- **Navigation** — display hierarchy, favorites shelf, run/hold and simulation-speed controls.
- **Engineering icons** — shared SVG Control Module, Equipment Module and function-block icons in Explorer, Control Studio hierarchy/palette, and diagram headers, based on IMG_0440. Equipment Modules retain an explicit EM identifier; unsupported reference composites are not fabricated.
- **Control Studio presentation** — reference-style gray block frames with name-left/icon-right headers and real input/output terminals. Grouped Home/Diagram/View ribbons provide faceplates, Explorer properties, alarms, supported history views, pane toggles, and 50–150% diagram zoom. Unsupported clipboard/download commands are explicitly disabled. Layout and connections remain in diagram coordinates at every zoom level.
- **Executable control strategies** — actual AI → PID → AO stages, with separately selectable blocks, qualified PV/OUT references, manual I/O, limits, faults, and back-calculation. TIC-401/TIC-411 additionally execute PID → SPLTR → two independent AOs with real feedback paths and configured feedforward references. The splitter implements coordinate curves, CAS/AUTO/OOS, AUTO SP rates, lock hysteresis, downstream balancing, and direction-aware limits based on the local function-block reference.

## Tech stack

- **Electron** (desktop shell, installable with a desktop icon)
- **React + TypeScript** (renderer UI)
- **Vite / electron-vite** (build tooling)
- **Zustand** (simulation + UI state)
- **electron-builder** (NSIS Windows installer)

## Getting started

```bash
npm install        # install dependencies
npm run dev        # run in development with hot reload
```

## Build a desktop app

```bash
npm run icon       # regenerate the app icon (build/icon.png)
npm run build      # compile main/preload/renderer bundles
npm run dist:win   # produce a Windows installer in dist-installer/
```

The installer (`dist-installer/BatchLive-1.0.0-setup.exe`) creates desktop and
Start-menu shortcuts.

## Control strategy training

Open TIC-401 or TIC-411 in Control Studio to inspect the five-block split-range
strategy and its connected flow indicator. Select AI1, PID1, SPLTR1, AO1 or AO2
in the hierarchy to edit its actual settings. Removing and reconnecting wires
changes execution; it is not just diagram styling.

The default **STAGED** actuator model preserves the earlier process response.
The explicitly selectable **HEAT_COOL** preset uses opposing slopes and a 49–51
deadband. AO manual operation, limits and faults affect applied actuation and
therefore the process. PID faceplates distinguish the PID command from each
applied AO and the combined field actuation.

SPLTR behavior is grounded in `175179979-DeltaV-Function.pdf`, PDF pages 284–292
(printed pages 278–286). These are simulated actuators, not physical-controller
downloads or exact vendor Fieldbus status handshakes. AO2 is virtual, not a
second hardware CHARM binding. Existing WFI labels remain shared aliases rather
than newly claimed one-to-one physical heater/cooler valves.

Run the focused engine regressions with `npm run test:control`, then
`npm run typecheck` and `npm run build`. The appearance and regression contract
is maintained in [GRAPHICS-APPEARANCE-AND-BEHAVIOR.txt](GRAPHICS-APPEARANCE-AND-BEHAVIOR.txt).

## DV-09 functional coverage

The primary DV-09 source is the 575-page Engineering Training manual.
The **full extracted-text review is complete**, but exact operating parity and
image-only PDF review are **not complete**. The source-order findings and
acceptance criteria are in
[DV09-LINE-BY-LINE-AUDIT.txt](DV09-LINE-BY-LINE-AUDIT.txt);
[DV09-LINE-DISPOSITIONS.csv](DV09-LINE-DISPOSITIONS.csv) maps all 12,157 source
records to 128 reviewed groups across 575 pages without copying the manual.
Verified workflows and remaining implementation gaps are recorded in
[DV09-FUNCTIONAL-COVERAGE.txt](DV09-FUNCTIONAL-COVERAGE.txt).

Explorer supports creating and renaming actual plant areas, shared by module,
equipment and SFC configuration. Physical Network commissioning offers an
optional I/O auto-sense step and accepts DV-09's 255-character descriptions.
Display Builder supports configurable Previous/Next links: `Ovw_ref.grf`
opens Overview, `alarmList.grf` opens Alarm List, and created picture names
open custom builder pictures in Run mode. These are session-local simulator
definitions, not native DeltaV database downloads or `.grf` files.

Physical Network now supports a traditional eight-slot/eight-channel AI/AO/DI/DO
training inventory with independent, enabled Device Signal Tags. Control Studio
binds DI `IO_IN` and DO `IO_OUT` to actual discrete channels, offers AUTO/OOS,
separates `SP_D` command from `PV_D` applied state, and configures discrete
alarm ON VALUE 0 or 1. Explicit simulated DO-to-DI tiebacks update after output
execution; DI reads that signal on the following scan. Faults hold the last
signal with Bad quality rather than reporting the command as confirmed feedback.

The course DST exercise uses a separate blank training session so the existing
pharma `XV-101` valve is not overwritten. Creating a blank project discards that
session's current project after confirmation. Standalone AI and PID AI1/AO1/AO2
stages now support analog DST binding. Manual AI channel signals are engineering
values clamped to the module range; bound inputs bypass synthetic process drift.
AO channels carry applied percent output, retain hardware readback during faults,
and preserve existing limits, manual modes, back-calculation and splitter balance.
New AI indicators expose disabled HI/LO alarms so the course's LI-101 thresholds
can be explicitly configured without adding unexpected alarms to local indicators.

Explorer and the I/O palette offer a real standalone AO module. The LEVEL-101
subset supports a Floating Point input `CAS_SP`, its actual wire to `AO1.CAS_IN`,
engineering `PV_SCALE`/SP limits, and `IO_OUT LY-1`. CAS 500 on a 0-1000 gal scale
drives 50% at the actual channel. AUTO uses SP, MAN uses percent output, and
OOS/disconnected/invalid/down paths hold the last hardware readback with Bad.
Explicit simulated AO-to-AI tiebacks convert percent through the receiving
module's engineering scale on the following scan; manual AI inputs retain their
engineering-unit behavior. This is not electrical conversion or device feedback.

Arbitrary typed parameters/paths, 4-20 mA scaling, discrete CAS,
native templates, controller/display assignment, and the configuration/runtime/
Save/Download/Online lifecycle remain gaps. These channel settings are
immediately live and session-local, not saved controller configuration.

Module creation in Explorer and Control Studio now enforces the course's
16-character naming rule and reports invalid/duplicate/denied creation without
false success. Existing protected equipment and graphics are unchanged.

Validate audit mapping with `node scripts\validate-dv09-audit.mjs` and
`node --test tests\dv09-audit.test.cjs`. These reference-specific checks require
the local `pdf_om.txt` extraction identified in the report, not bundled source
material. Zero unmapped lines proves traceability, **not feature coverage**.

Workshop checkmarks are a manual exercise checklist, **not verified coverage**.

## Project layout

```
src/
  main/        Electron main process (window, menu)
  preload/     Context-isolated preload bridge
  renderer/
    src/
      engine/      Simulation engine (types, plant, PID/physics, store)
      components/   Banner, top bar, nav, status bar, graphics, dynamos
      faceplates/   PID / Motor / Valve / AI / Discrete faceplates
      displays/     Overview, area detail, alarm list, trends
      ui/           Navigation + faceplate window state
scripts/
  gen-icon.mjs   Dependency-free PNG icon generator
```

## License

MIT
