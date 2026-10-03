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
