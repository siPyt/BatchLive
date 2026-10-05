# BatchLive (BL)

An offline **operator HMI sandbox** that recreates the look and feel of an Emerson **DeltaV Live** station — process graphics, control-module faceplates, an alarm banner/summary, live trends, and a running process-simulation engine — so you can safely experiment, train, and prototype operator workflows.

> BatchLive is an independent educational simulator. It is **not** affiliated with or endorsed by Emerson, and ships no DeltaV software.

![BatchLive icon](build/icon.png)

## Features

- **Live process simulation** — a continuous reactor train (feed → reactor → product) with tank hydraulics, temperature/pressure dynamics, and a classic cascade loop (feed-tank level → feed flow).
- **PID faceplates** — PV/SP/OUT bargraphs, MAN/AUTO/CAS/OOS mode switching, qualified tracking LO, setpoint & output control, and a tuning tab (gain / reset / rate).
- **Device faceplates** — motors (start/stop, interlock, fault injection, runtime), on/off valves, analog indicators, and discrete I/O.
- **Alarm system** — Critical / Warning / Advisory priorities, blinking unacknowledged banner tiles, acknowledge-per-point or acknowledge-all, and a sortable/filterable alarm list.
- **Process graphics** — interactive SVG tanks, pumps, valves and piping with live dynamos; click any element to open its faceplate.
- **Classic equipment symbols** — compact centrifugal pumps, blue-framed isolation valves, unboxed hand valves and dome-actuated control valves based on the WFI reference display. Running/open equipment is green; stopped/closed equipment is black. Pump/isolation-valve feedback and applied analog actuation drive the colors, not unapplied commands. WFI reference captions are aliases for the simulator's existing modules; tooltips identify the underlying tag. Unbound valves are reference-only symbols, not simulated controls.
- **Historian trends** — multi-pen real-time charts with selectable pens and time windows.
- **Operator ribbons** — three gray icon/navigation bands based on IMG_0602, with display/module search, Back/Forward/Up/Home, a complete picture selector, and the alarm banner below the working area. BatchLive branding is preserved. Sidebar/favorites and area module directories remain available on demand; run/hold and speed controls still operate the same simulator.
- **Main displays** — an IMG_0616-style fixed navigation overview of three live summary panels (Feed Tank, Reactor Train, WFI Tank and Loop) with bordered navigation buttons to every other area, plus full-width process graphics rather than module-card dashboards. Feed/reactor/product views focus the existing spatial plant canvas; the original whole-plant canvas remains available as Original Spatial Plant Map. Following IMG_0636, the overview also shows live N3/N1/N1BP loop panels (In Use / Not In Use, level-control and sanitation boxes) and a Rooms and Storage Tanks section (Room 1040, 1040A, 1042). Those room vessels and the extra navigation boxes (NGS-808, Scrubber 3S-8050, CIP-804, WFI Pretr Skid, 3TCU-8010/8020, Glycol 3T-8150, Process Waste, 3UF-8201, HCL Totes, PW Neutr., 3SUR-3300/3200, Buffer Prep, 3CIP-3200, 3T-3300/3350) are layout-only and clearly marked not modeled, with no invented readings. A larger three-tank Photographed WFI Overview (N3/N1/N1BP) is a separate route. Incomplete pictures identify missing required modules instead of rendering blank. Reset Graphic View resets only the picture camera/layout, not live modules, process state, or open faceplates.
- **Connected photographed WFI expansion** — opt-in N3/N1/N1BP tank loops and WFI still, with shared steam/cooling effects on the existing reactor/pharma units, conserved N1-to-existing-WFI storage transfer, and a common WFI supply for the three CIP skids. Installation adds to the existing plant without replacing modules or resetting exercises. This is the first expansion milestone, not a completed model of every photographed area.
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
Visual milestones and unresolved reference-only/modeling gaps are recorded
separately in [VISUAL-FIDELITY-LOG.txt](VISUAL-FIDELITY-LOG.txt).

## Connected whole-plant training expansion

Open **Photographed WFI Overview** from Plant Overview or the picture selector.
The default pharma project now installs these units automatically; a blank
project, or one without them, shows an installer. As an unlocked user with
configuration permission, select **Add photographed WFI
training units**. This explicitly enables the integrated model in the current
project: existing modules, faceplates, SFCs, batch state and hardware are retained;
shared supply constraints now affect their process response. Without installation,
the previous standalone simulation behavior is unchanged. New Project clears the
expansion. The expansion is runtime state, not a saved project/restart guarantee.

The connected paths currently implemented are:

- Shared steam header → photographed still/tank heating, reactor heat, legacy WFI
  heating, autoclave heat/positive pressure, and CIP heating.
- Shared cooling → photographed loop coolers and legacy TCU/lyophilizer chilling.
  TCUs retain electric heating; they are not represented as steam heaters.
- WFI still → three independently controlled storage tanks.
- N1 distribution → retained legacy WFI storage receiver → all three CIP skids.
  Distribution pump/return-valve and CIP pump/supply-valve feedback gate delivery.
  Concurrent demands share available water; empty storage cannot provide flow.
  Received conductivity/TOC are mixed into the existing WFI quality instruments,
  so the existing out-of-spec divert strategy remains connected.

Use **SB-STEAM** and **SB-COOLING** faceplates on any photographed display to
stop/fault the shared supplies. Their live pressure/availability indicators also
appear in the standard trend/alarm system. Utility loss affects dependent process
values; it does not magically stop every device or override existing SFC logic.
The original reactor material feed/product balance is retained, not relabeled as
WFI. Hardware-bound/manual inputs still take precedence over simulated readings.

For still startup, open its real equipment faceplates: start the oil pump, wait
for adequate oil pressure, then reset/start the compressor. Open feed isolation;
the heating and level controllers supply their applied outputs. Open delivery
isolation and start the distillate pump; open each destination's fill valve.
Tank recirculation and distribution are separately commanded. Commands do not
substitute for confirmed running/open feedback.

Tank sanitation heats toward an 85°C target, requires 600 continuous simulated
seconds at ≥80°C with circulation, then requests a 25°C target and completes at
≤30°C. Losing heat/circulation resets the soak. Invalid, OOS, tracking or overridden
temperature control aborts the shortcut rather than overwriting operator control.
Lifecycle-managed controllers/devices must use their deployed controls instead.
Cancel/reset sanitation requests 25°C and leaves the pump under operator control.
Run/Hold and the simulation speed apply to the coupled model and its timers.

**Sandbox assumptions:** each storage tank and the retained legacy receiver are
7000 L, still feed/distillate capacities are 1000/500 L, maximum production is
0.8 L/s, aggregate still delivery is 2 L/s, tank distribution is 0.35 L/s,
and drain flow is 1.5 L/s. The feed boundary supplies assumed available clean
water; distillate conductivity is assumed 0.3 µS/cm. Steam and cooling have
simplified finite-response availability models, not site utility engineering.
The retained legacy receiver is an extra training buffer, not a claim that the
photographed site contains two physical N1 tanks. Sandbox module suffixes are
not a certified one-to-one mapping to every photographed tag.

PW neutralization, SUR-3300/3200, Buffer Prep, CIP-3200 and tanks 3300/3350 still
need photographed-area models and explicit interconnections. Existing pharma
physics remains simplified; utility coupling does not certify all site recipes,
phase arbitration, sterilization, GMP procedures or piping. This expansion is
being built toward one connected whole plant, not claimed complete already.

**WFI Still (IMG_0604 layout):** the still picture follows the photograph: feed, distillate
and blowdown exchangers, evaporator with feed-water and distillate level bars, compressor
with motor current, oil pump with oil pressure/temperature indicators, SV500 oil cooler
cooling water, steam valves TCV102/PCV103, level valves LCV100/LCV200, TCV200,
XV200/XV201/XV202/FCV300, Hot Standby status and the N3/N1/N1BP loop navigation.
All of these are real sandbox modules (TCV102 is the existing TIC102 output; LCV100 is the
LIC100 output; TCV200 uses incoming feed water, not plant cooling). PCV103 starts in manual
at 0%, LCV200 in manual at 100%. Oil temperature rises with the compressor and needs SV500
and cooling water; waste, drain and blowdown remove water only on valve feedback; LCV200
throttles delivery. Photo labels XV201 twice (Storage and Waste); the waste valve is
modeled as XV202. WFI STILL COMMS is shown but not modeled.
Run `node --test tests/photo-plant.test.cjs tests/operator-ribbons.test.cjs` for
the coupled-system, preservation, quality, interlock and navigation regressions.

Run `npm run test:sfc` for SFC qualifier timing regressions against the original
DV-09 timing-chart image. SFCs and batch phases share independent action lifetime
state for N/R/L/D/P/S/SD/DS/SL. Named reset targets stop stored execution; they do
not invert earlier assignments or fabricate actual device feedback. Timed pulse,
stored delay across step exit, delay cancellation and stored limits are supported,
including the existing structured condition subset. Full native action-property/
expression features, universal expressions, general non-Boolean block activation
and native graph editing/nested parallel graphs remain gaps.

Managed SFC **Add Parameter... / Parameter Properties** now supports **Boolean**
as well as Named Set defaults. In Action Properties choose **Type: Boolean
parameter** and reference a local parameter, for example `'ACTIVE.CV'`, rather
than an assignment. Expression Assistant lists only that SFC's Boolean references.
The qualified action drives TRUE while active and FALSE after deactivation,
expiration, reset or completion. Stored qualifiers retain activation across step
exit; R resets their named action. P lasts one execution scan after its delay.
Multiple active actions on a local flag combine by OR; parallel conflicting
writers are rejected. `'ACTIVE.CV' = TRUE` or FALSE (also 1/0) can be used in
transitions and timing conditions. HOLD/controller loss freezes the actual flag
and clock. Reset clears action-driven flags but retains unreferenced parameter
values. Draft/default/saved/deployed/runtime values remain isolated; Named Set
operator-entry controls cannot write Boolean parameters. This implements the
course's Boolean action class in the simulator, not every native action/property
or general function-block activation workflow.

For the optional timed-SFC-alarm exercise, add a local custom **Alarm Type**
(description/priority), an **ALARM Function Block** monitoring action time
**> 30 seconds**, and an **SFC Alarm** referencing that type and block.
Add an initial **Non-Boolean function block** action referencing `'TIMECHK'`
(or the configured block name), with qualifier S and a unique action name.
It runs the shared ALARM block engine and continues its one clock across step
exit until R/reset/completion. Save, Download and Online remain required.
An unstarted block or disabled alarm cannot fabricate a timeout. At exactly
30 seconds there is no alarm; the next positive scan above 30 triggers it.
HOLD/controller loss freezes the monitor. The real Alarm List/banner uses
the SFC tag, configured priority and elapsed seconds; its module link opens
that exact chart, not an invalid faceplate. Shared ACK, silence, shelving,
return-to-normal and Event Journal behavior apply. Reset clears monitor
state, and the next plant scan reconciles the alarm. Re-triggering an
unacknowledged returned alarm refreshes its activation time and re-sounds
the horn. Types here are SFC-local saved/deployed configuration; global
Alarm Type/Changed Setup Data workflows, general block palettes/wiring,
arbitrary non-Boolean algorithms and full course parity remain incomplete.

For the optional startup-level/reset exercise, add visible but nonselectable
waiting states to the MESSAGE Named Set and pulse the appropriate MESSAGE
assignment in each waiting step. Before starting the motor, add a level
transition such as `'^/LI-101/AI1/PV.CV' > 100` (100 is an example chosen
threshold, not a mandatory course value), then a pulse assignment
`'^/MTR-102/DC1/RESET_D.CV' := 1`. Expression Browser exposes RESET_D for
motors/valves; inline Action Editor also supports deviceReset. Save/Download/
Online apply. RESET_D clears only the actual lock latch, using the same
operation as operator Reset; it does not START, clear an interlock/fault,
make a permissive true or fabricate confirmation. `:= 0` does not reset,
and qualifier expiry never writes an inverse. Bad/nonfinite level values
cannot release the transition; AO PV comparisons also reject OOS.
The next command step must still wait for actual motor-running feedback.
HOLD/controller loss freezes the sequence while physical I/O can continue
changing. A real operator-picture MESSAGE entry and wait labels are verified.
The modeled MOTOR is still not the native MTR-11_ILOCK template.
External XI-2/ZX-2 bindings are now available as described below; native
template/interlock configuration and full DV-09 parity remain incomplete.

Control Studio can wire a live **PERMISSIVE_SOURCE** to a motor or valve,
using the Parameter View or a wire into **PERMISSIVE_D** on the DC block.
The source strategy executes before the device. Good nonzero feedback permits
a new start/open when the Permissive option is enabled; Bad, OOS, nonfinite
or missing feedback denies it, including a logic block holding a previous
high output. Loss of a permissive is not an interlock: already-confirmed
equipment stays active, while a separate interlock still trips and requires
reset. The parameter row reports actual Good/Bad and permitted/denied status.
Deleting the wire clears the inherited permit and restores explicit manual
permissive control. This is executable live wiring, not the native
MTR-11_ILOCK template. First-out/bypass and the separate saved device workflow
are described below; they do not provide native template parity.

For external motor/valve confirmation, create enabled DI and DO channels in
Hardware, then select **IO_IN_1** and **IO_OUT_1** in Control Studio. The
course motor uses **XI-2** on card 3 channel 2 and **ZX-2** on card 4 channel 2.
These are independent signals: START/OPEN resolves the output through the
device's permissive/interlock/reset logic; only good DI feedback confirms
Running/Open. Elapsed confirmation time reports failure, never invents feedback.
STOP/CLOSE writes the passive output and waits for actual passive feedback.
Manual DI simulation and explicitly selected DO-to-DI simulated tieback are
available in Hardware; a binding never silently adds a tieback.
The faceplate and Parameter View distinguish requested, resolved and applied
output from feedback, including held Bad values. Missing/disabled/nonfinite
channels or a down controller produce Bad quality and a FAIL alarm. Bad
feedback/output cannot satisfy SFC device transitions. Bad feedback requests
a passive output; a failed DO holds its actual previous value, not a fictitious
successful write. Recovering a channel does not clear an injected field fault.
Both ports are required once external I/O is selected; a partial binding stays
Bad. An output has one writer across device and standalone DO bindings.
Referenced DSTs cannot be renamed, and energized/unconfirmed devices cannot
be rebound or deleted. Unbound equipment retains its existing internal
confirmation behavior. These settings are session-local live configuration,
not native motor Save/Download or physical wiring certification.

For the sustained motor trip condition, wire **CND2.IN1** to **LI-101**,
enter `IN1 < 50` and **Apply**, then set **TIME_DURATION = 4 s**. CND expressions
support arithmetic, parentheses and `>`, `<`, `>=`, `<=`, `=`, `==`, `!=`, `<>`
comparisons over IN1/IN2. This is a wired-input subset, not the native quoted
cross-module expression language. Unapplied text is explicitly marked and does
not execute. Invalid syntax/delay rejects with a diagnostic and notification;
division-by-zero/nonfinite results report Bad at runtime, never a Good zero.
Only continuously true, good feedback accumulates time: 3.9 s stays false,
4.0 s becomes true, exactly 50 is not low, and false/Bad input resets timing.
Rewiring or changing the expression/duration starts a fresh interval.
For the closed-valve condition, wire CND1.IN1 to XVSTAT-101, use `IN1 = 0`
with zero delay, and combine CND1/CND2 through OR into the motor interlock.
Bad/missing/OOS interlock sources now fail safe as **Bad - tripped**, rather
than clearing a trip from a held/absent signal. Reset Required retains the
lock after the condition clears until explicit Reset. With external I/O,
the trip de-energizes ZX-2 before separately sampled XI-2 confirms Stopped.
The exact native MTR template remains incomplete; the modeled owned
two-condition template below executes the course's safety dependencies.
The separate first-out/bypass subset is described next.

The two-input **BFI** now exposes independently readable **OUT_INT**, **OUT_D**
and **FIRST_OUT**. Enable **ARM_TRAP** in Parameter View to capture the weighted
input combination on a good all-zero to nonzero transition (input1=1, input2=2).
Later causes do not overwrite it while any cause remains active. **RESET_IN**
clears only the trap and pulses back to zero; capture cannot rearm until every
input clears. A subsequent zero-to-nonzero transition can capture a new cause.
Bad inputs retain explicitly Bad live outputs, not fictitious good trip values.
The previous captured cause retains its own quality.
**CND.BYPASS** inhibits a healthy condition and resets its timer. Removing bypass
requires a fresh delay. Bad input remains Bad even when bypassed, so the wired
interlock remains fail-safe. Wire two CND **BYPASS** parameters into a separate
OR for actual bypass indication, independent of trip/first-out. Parameter View
provides named-output choices; bypass, arm and reset require Restricted Control,
an unlocked workstation, and produce journal entries.
This is the verified two-input trap/bypass subset, not sixteen-input/BCD BFI,
the native motor template.

For isolated saved **MOTOR/VALVE** configuration, stop/close and confirm the
device, then use **Enable Saved Device Lifecycle** in Control Studio Parameter
View. The device is inhibited until its first download. Offline draft controls
configure controller, independent DI/DO DSTs, permissive/reset options,
confirmation time and interlock/permissive/command sources. Save persists only
configuration in this browser profile, not commands, feedback, lock or fault.
Load replaces only the offline draft; it never implicitly downloads or actuates.
Go Offline does not stop a previously deployed runtime.
**Download Device** offers an explicit Full confirmation/cancel dialog.
Download requires a saved unchanged draft, stopped/closed device, commissioned
available controller, both correctly typed/owned scanned-Good channels and
passive physical DI/DO. Duplicate writers and CHARM conflicts reject.
Failure/cancel retains last-good runtime/bindings/revision; a successful
transfer preserves actual device fault/lock and feedback, then requires real
external DI confirmation. Connected command sources execute on subsequent
scans and may command active. Online prohibits draft editing. Managed
faceplates display deployed options and direct edits back to offline Studio.
Save/Load/Edit and Download use the appropriate permissions plus workstation
lock checks; persistent storage errors are notified and journaled.
This models Full device deployment, not full native template parity, Partial
download, upload/NVM restoration, or physical controller communication.

In Explorer **New Module**, select MOTOR and **Library / Motors-2State /
MTR-11_ILOCK** to create the modeled two-condition owned template. It creates
one motor with namespaced **CND1/CND2/BFI1/OR1/NOT1/AND1**, not independently
running modules. All owned configuration edits are offline, isolated from
deployed runtime, and persist/deploy with the motor in one Save/Full Download.
Click its owned block buttons to edit, and use the Owning motor button to
return to Save/Download. Ribbon Save/Download/Properties route to the owner;
Faceplate opens the real motor, and the caption reflects Offline/Online.
Both wired IN expressions and the exact quoted p230 expressions work:
`'//XVSTAT-101/DI1/PV_D' = 0`, duration0, and
`'//LI-101/AI1/PV' < 50`, duration4.
The `.CV` qualified value suffix shown in the p226 image is also supported.
Quoted paths use actual qualified DI/AI feedback and dependency ordering,
not textual substitution or JavaScript eval. Wrong source types/paths reject;
Bad/missing sources reset elapsed time, propagate Bad, trip fail-safe, and
journal failures/recovery. This applies even when bypassed.
BFI1 feeds NOT1, whose1 denotes a healthy native interlock signal; the
explicit saved **native interlock polarity** maps its0 to a trip. Bad always
trips independently of polarity. Existing devices retain active-trip-at1.
AND1 drives the independent start permissive (default constants1; configure
real permissive dependencies in its IN1/IN2). OR1 reports CND bypasses.
Online bypass/arm/reset operate the downloaded blocks; configuration and
independent deletion are rejected while online. Deleting a stopped,
confirmed motor deletes its owned graph, but does not implicitly erase
the browser's saved configuration.
The motor faceplate shows captured cause descriptions, current condition
quality/trips and independent bypass indication. Its first-out Reset clears
history only, never the motor lock or active trip. Bypass controls require
an Online deployed strategy and available controller, use Restricted
Control/lock checks, and are journaled. Offline drafts can be loaded and
repaired before recreating their hardware; Download still validates every
current controller/channel dependency.
This is the two-condition executable course subset, not the original
eight/sixteen-condition palette, library drag/drop, configurable state masks,
all DC options/named descriptors, or full DV-09 completion.

The **Operating MTR-102 at the prescribed 500 and 10 gallons** workshop now
connects those dependencies in a separate training project. Saved/deployed
LEVEL-101 AO, CAS_SP and 0-1000 gal scale/limits drive LY-1 card2channel1;
explicit simulated tieback to LT-1 card1channel1 gives sampled LI-101.
500 gal produces 50% and 10 gal produces 1%, not a manually forced AI value.
XV-101 DO XV-1/card4channel1 drives separately sampled XVSTAT-101 DI
LSO-1/card3channel1 through an explicit simulator tieback. Owned MTR-102
uses XI-2/card3channel2 and ZX-2/card4channel2 independently.
At 500 gal the actual faceplate operates the motor. Closing the valve
trips cause1 on sampled feedback; 10 gal trips cause2 at four continuous
good seconds, not 3.9. Output shutdown precedes stopped feedback.
Reopening/raising level does not erase the required motor reset or trapped
history. The 50 gal threshold and Bad-input recovery are regression tested.
These are labeled simulator signal connections, not physical wiring or a
fluid-dynamics claim; approved plant equipment and colors are unchanged.

Saved MOTOR/VALVE configurations can also map four **Named Set device
descriptors** independently: passive/active command and passive/active feedback.
The XV-OPTION workshop uses visible Hold0/Flush1 command entries and
Holding2/Flushing3 feedback entries. These numbers identify descriptor names;
actual SP_D/PV_D remain 0/1. Transfer Changed Setup Data separately to the
controller and workstation, select/map the entries in the offline device
descriptor draft, **Apply Device Descriptors**, Save and Full Download.
Faceplate buttons, command/feedback rows, Studio raw/named values and journal
use deployed names. Flush does not manufacture Flushing: good independent
DI confirmation is still required; Hold can coexist with held Flushing.
Missing setup is explicitly Bad and active operator entry is denied, while
authorized passive entry remains available. Physical Bad feedback retains
its held value/name with separate quality. Workstation lock denies both
operator command directions. Offline edits/Load remain isolated; clearing
descriptors returns default labels only after Save/Full deployment.
This is explicit role mapping, not native DC state-mask or full valve-template
dialog parity; existing mechanical graphics and default labels are preserved.

Explorer **ProfessionalPLUS (simulated) -> Licensing Properties** reports
distinct actual referenced AI/AO/DI/DO hardware signals and their module,
port, channel and controller. Shared readers/internal FB references do not
duplicate usage; unused named channels and unbound modules allocate zero.
LI-101 LT-1 counts one AI; binding FIC-102 FT-2/FY-2 adds one AI and one AO
exactly once. A bound AO2 is a distinct output. Disabled/pulled signals stay
allocated; enabled/installed counts are separate. Unresolved/wrong-type
references produce an explicitly incomplete report. Counts follow current
live/deployed bindings, not untransferred drafts.
This read-only report does not model purchased license capacity, allocate
substitutions, enforce vendor licenses or fabricate a physical System ID key.

SFC charts now provide right-click **Add...** in a selected step's Action
window and **Properties...** on existing actions/transitions. Properties are
isolated drafts: OK validates and applies, while Cancel/Escape retain the
original. Expression Assistant opens a supported-path Browser; assignments
and conditions resolve into actual engine actions, not JavaScript evaluation.
Check reports supported algorithm errors without executing it. Stale,
unauthorized or running-chart commits reject atomically. Configured Named Set
MESSAGE expressions are supported; native Confirm, arbitrary expression
features and graph workflows remain incomplete.

In Explorer, right-click an Area → **New → Control Module...** and choose
**Algorithm Type: Sequential Function Chart**. Create opens the named empty
chart as an Offline managed draft, with no implicit Save, Download or execution.
Its area row provides properties and **Open SFC**/double-click navigation to
that exact chart. The default Function Block Diagram option retains existing
PID/AI/AO/MOTOR/VALVE/DI/DO/FB creation. Names are validated and shared between
FBD modules and SFCs; duplicates, missing areas, denied keys and FlexLock reject
creation without partial algorithms. Cancel does not create an object.
SFC creation also preserves **Description** and **Equipment Module** membership.
The selected equipment must exist in the same area. Explorer displays configured
descriptions and nests assigned SFCs under their equipment group; counts include
both FBD and SFC modules. This remains a supported algorithm-choice/metadata
subset, not native dialog/template or Save As parity.
The same creation form is available from **Control Studio → File → New...**
and **SFC Charts → New Control Module...**. An empty Studio also provides New.
It starts with Function Block Diagram selected; choosing Sequential Function
Chart creates and opens the named Offline SFC. Cancel creates nothing and
FlexLock discards an open dialog. FBD creation from these Studio entry points
opens the exact new module in Studio; Explorer's existing creation behavior
is unchanged. This covers the p289 named-creation operation, not native
UNTITLED objects, Start From Existing, template-library or Save As workflows.

### Managed module download status (DV-09 pp92–95 subset)

Explorer module rows, Control Studio and saved-lifecycle controls share a
module-scoped indicator for managed AO, PID_LOOP, MOTOR/VALVE and SFC modules:
**yellow triangle** means no deployed configuration; **question-mark triangle**
means a changed saved configuration has not been compared; **blue triangle**
means **Update Download Status** confirmed a saved/deployed difference.
Matching saved/deployed copies show **Up to date** without a triangle.
Update requires an unlocked workstation and Configure permission; it compares
only, logs its result and never downloads, changes outputs or saves data.
Controller unavailability rejects the comparison explicitly.

Unsaved editor drafts retain their separate dirty indication and do not
represent the saved configuration database. Re-saving unchanged data does not
create a false difference, regardless of revision numbers. Online tuning and
process values are not automatically uploaded into saved configuration.
Failed or cancelled downloads preserve the difference; successful transfer
clears it. Checks are session-local and reset with New Project.
Live/unmanaged modules do not receive a fabricated native status. This is not
a whole-controller/network comparison, whole-controller Total/Full download
or card download implementation.

### SFC saved/deployed lifecycle

Reset an existing sample SFC and choose **Use Save/Download lifecycle** to opt it into isolated
configured, saved and deployed linear algorithms. **Module Properties**
assigns its configured controller, description and same-area equipment membership
in one isolated draft. OK applies all fields atomically; Cancel/Escape discard
them. Stale, missing/wrong-area, unauthorized, locked, Online and active-chart
edits reject. **Save** validates/persists browser
configuration without changing execution. **Download...** confirms transfer
to an available commissioned target and leaves the SFC READY without executing
actions. **Go Online** displays/operates the deployed chart; **Go Offline**
shows its separate draft, not live activity. Reset the deployed routine before
editing or replacing it. Draft edits and saved snapshots never silently change
the running algorithm. Check validates whichever configuration is displayed.
Controller unavailability pauses managed chart execution/timers; this is not
native controller restart behavior or nonvolatile restoration. Saved drafts
can be explicitly loaded after recreating/attaching the SFC; fresh Download
is required after reload. Current project area membership is preserved.

Existing sample charts retain opt-in lifecycle to preserve session-local behavior;
Explorer's new SFC algorithm path starts managed.
`npm run test:sfc` covers qualifier, Properties/parser and lifecycle
regressions, including algorithm creation/navigation, MESSAGE parameters and
picture entry. Native templates/graph editing, broader download dialogs and
restart restoration remain gaps.

Explorer **Setup > Named Sets** provides case-sensitive custom-set creation
and draft **Properties > Add/Modify > State Properties**, including separate
Visible and User Selectable flags. Configure NS-T101 with STARTUP=1 and
SELECT SEQUENCE=255; make the latter visible but not user-selectable.
Properties OK validates and persists configured sets to this browser profile;
Cancel/Escape discard drafts. **Load Saved Named Sets** explicitly restores
configured data without altering deployed copies. **Download Changed Setup
Data** transfers the Named Set subset only, independently to an available
commissioned controller or the simulated local workstation. The target's
deployed values are shown separately. Configuration and download require
their respective keys and an unlocked workstation.

Run `npm run test:named-sets` for configuration, persistence, permissions and
target-specific transfer regressions. This is not a complete native Setup
Data download: other categories, protected vendor defaults and reference
tracking remain gaps.
Configured values use the simulator's safe-integer and existing 16-character
tag syntax, not an assertion of vendor numeric/name limits. Deployed copies
are session-local; loading browser configuration does not deploy it.

For a lifecycle-managed SFC, **Add Parameter...** opens draft Parameter
Properties. Name it MESSAGE, choose Named Set NS-T101 and default SELECT
SEQUENCE (255). The configured value can be a nonselectable prompt. Save and
Download preserve independent configured defaults and actual runtime values;
parameter edits never immediately command the deployed routine.
Action/Transition Properties and the Browser support exact named expressions:
`'MESSAGE' := 'NS-T101:SELECT SEQUENCE'` and
`'MESSAGE' = 'NS-T101:STARTUP'`. State names are case-sensitive, references
must exist, and unsupported syntax is rejected rather than evaluated.
Assignments use normal qualifier semantics: an N prompt repeatedly writes255;
P fires once at its configured time/condition. Missing transferred references
hold execution and produce an explicit journal diagnostic.

In Display Builder, configure a datalink with the SFC tag and MESSAGE.CV,
then choose **Named Set** in Data Entry Expert. **Run** displays the
workstation's transferred state label and opens a command-selection dialog.
Both controller and workstation setup must contain matching visible,
user-selectable states; SELECT SEQUENCE is displayed but not offered as a
command. Cancel/Escape/FlexLock do not write values. Apply writes the real
deployed parameter with CONTROL permission, not its configured/saved default.
Disabling entry retains a read-only Named Set datalink. Existing AO numeric
entry/fill dynamics remain separate and cannot bypass these selection flags.

Transition Properties also provides an explicit **When true, go to** destination:
next sequential step, any named step (including a return/self-loop), or complete.
Check/Save/Download reject missing targets. Each scan crosses at most one
transition, so a TRUE loop cannot recursively hang the simulator. Pulse actions
re-arm on step re-entry; timers reset while stored actions in other steps retain
their existing lifetimes. Routed charts show return connections and do not
mislabel earlier array rows COMPLETE merely because the active index is higher.
This destination selector is a simulator editing surface, not the native SFC
palette/connector workflow.

For a selective branch, set an explicit primary destination in Transition
Properties, then **Add alternate route** with its condition and destination.
Primary is evaluated first, followed by alternatives in configured order;
only the first true path activates. If all are false the step remains active.
Different branch-ending steps may share a destination to converge, then return
to the initial prompt. Conditions/bindings/targets are validated by Check and
saved/deployed independently. The route summary and connection titles show
the actual configuration without claiming the native branch palette/layout.
For parallel divergence, first create independent branch steps and a shared
join step; route each branch's ending transition to that join. On the fork's
Transition Properties enable **Activate parallel paths**, select at least two
branch starts and choose **Synchronization join**. OK validates and applies
the fork and all-predecessor join atomically; Cancel changes neither.
Each branch has an independent active token, elapsed timer and nonstored action
runtime. A completed branch waits at the join without keeping its nonstored
actions active. The join enters only after every listed predecessor passes.
HOLD/controller outage freeze all tokens; Reset, completion and Download clear
their runtime state. Return after the join re-arms the next cycle.
Check/Save/Download reject missing/duplicate targets, orphan joins, bypass routes,
overlapping/cyclic legs and conflicting branch writes. Stored outputs have one
owning step in parallel charts. The current supported graph consists of disjoint
acyclic legs between a fork and join; nested/selective legs are rejected, not
silently flattened. Live chart activity/timers and the join-arrival summary
show all active paths. The existing supplemental connections do not reproduce
the native parallel graph palette/layout.

Properties/Browser and inline transitions support separate DI feedback
(`'^/XVSTAT-101/DI1/PV_D.CV' = 1`) and confirmed analog modes
(`'^/FIC-102/PID1/MODE.ACTUAL' = AUTO`; AO uses AO1). Bad or OOS DI
feedback never releases a transition, even when its held value matches.
Mode comparisons read actual mode, not MODE.TARGET. DO assignments address
DO1/SP_D.CV; they do not write or fabricate the DI feedback.
The Sequencing workshops include configuration/dependency instructions for
the course-tag XV-101 DO, XVSTAT-101 DI, FIC-102 PID and MTR-102 motor subset.
Automated and live STARTUP/SHUTDOWN/STARTUP cycles verified separate channel
sampling, 50 GPM setpoint, output thresholds and return to MESSAGE255.
The shutdown fixture follows the p294 figure's stop/close/flow order; the
text-order difference remains recorded rather than silently certified.

This implements MESSAGE, feedback and selective/return-routing prerequisites,
not the complete pp291-294 procedure. Native motor/DC templates with external
XI-2 feedback, native branch editing/layout and nested parallel graphs remain outstanding.
Native parameter category/restart/instance/Browse workflows, general parameter
types and nonvolatile behavior are not claimed.

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
An exercise is complete only when its prescribed sequence and expected results
are executable, including configuration/download and operator boundaries.
Adapted simulator workflows or learner checkmarks do not certify completion.
The audit's **DATED CHANGE HISTORY** records actual Git timestamps and summaries
for every commit through the Pass53 implementation. Its **EXACT KNOWN REMAINING-
WORK INDEX** enumerates each non-context group once, separates functional gaps
from physical/vendor boundaries and points back to the full acceptance criteria.
An audit regression checks that no remaining group is omitted or duplicated.
Original-PDF image-only review can still reveal additional requirements.

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

Traditional AI cards support the DV-09 2.6-second input-filter subset.
Configure a nonnegative filter time per channel, then use **Download Input Filters**
and confirm the simulated filter-only card transfer. Configured and deployed times
remain distinct; cancelling, denied permissions, invalid settings or an unavailable
controller retain running settings. The first-order channel filter uses simulation
time, holds during Bad input, and filters AO tieback percent before receiving
PV_SCALE conversion. Zero bypasses it after transfer. This is session-local;
it is not a full card/controller download or the vendor DeltaV Tune workflow.

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

Standalone AO also has an **opt-in saved module lifecycle** in Control Studio.
Enable it in an isolated training session: the output holds until Save and the
first Full Download. Offline drafts, saved defaults, deployed configuration,
live values and simulated NVM are independent. Assign a commissioned controller,
Save, then Download the module. Cancelled or invalid transfers leave runtime
unchanged. The AO Download dialog requires **Verify Configuration** before
confirmation, reports reference/target/preservation checks and shows a running-
output caution with Cancel. Confirmation rechecks hardware and rejects a saved
configuration changed since verification; it cannot silently download a newer
revision. The dialog stays open with actual atomic transfer results and **Close
Download Results** after success. Verification and transfer events use the
simulator's event journal, not a native disk log. The synchronous module transfer
does not imitate asynchronous controller progress, licensing, Fieldbus dependency
checks or generic upload stages. Full uses configured values; Partial selects configured values,
critical block values only, or critical plus user-defined values. The DV-09
CAS/500 versus AUTO/555 exercise produces CAS/500, AUTO/500 and AUTO/555 respectively.
Physical Network's **Full Download Managed AOs** lists all enrolled AOs whose
saved or draft assignment targets the selected controller. Confirmation validates
the entire scope before committing one state update. Unsaved/invalid members,
changed saved configurations or membership, unavailable targets and denied/locked
access abort the entire batch. It refreshes each module's last-good snapshot and
any opted-in AO restart memory, leaving saved defaults and other controllers/
algorithms unchanged. This bounded controller-owned AO transfer is not native
Total Download: PID/device/SFC, I/O-card configuration and Setup are excluded.
The separate **Full Download Managed AO/PID** action includes enrolled AO and
PID_LOOP modules assigned by saved/draft configuration. It validates the entire
mixed scope before one atomic commit; a failing PID cannot partially download
the preceding AO. PID_LOOP must be saved, clean and Offline. Download keeps it
OOS with held output until explicit Go Online; saved tuning is applied without
uploading live tuning or rewriting browser defaults. Confirmation rejects changed
membership/saved objects and warns of both algorithm behaviors. Device/SFC,
card configuration and Setup remain excluded; this is not native Total Download.
**Full Download Managed Modules** extends this atomic scope to saved MOTOR,
VALVE and SFC lifecycles on the controller. Every module is prepared before one
commit. A running/open device, nonpassive or Bad channel, missing deployed Named
Set, dirty draft, Online/running/held SFC or changed confirmation scope aborts
the entire batch. Devices retain their individual download behavior: passive,
downloaded and requiring external confirmation. SFCs remain READY/Offline with
no actions executed. PID stays OOS until Online; AO uses saved defaults. These
shared preparation helpers also serve individual device/SFC downloads. Native
Total Download, unmanaged AI/DI/DO/FB algorithms, card configuration, Setup,
licensing, generic upload and Fieldbus are still outside this bounded command.
Online shows runtime; offline edits do not alter the deployed module. Upload
copies live values into a draft, requiring explicit Save before persistence.
Cold restart restores selected values only when both deployed module and
parameter restore flags are set. Power recovery outside the configured cold
restart window requires a fresh Full Download, not just commissioning.

**Re-send Last Good Module Download** replays the last successful AO transfer
without reading later saved defaults or downloading unsaved editor changes.
Each successful Full/Partial transfer captures a separate snapshot; a Partial
snapshot includes the critical/user values actually preserved at that transfer,
not whatever values happen to be live later. Confirmation changes only this
module's runtime and binding; Cancel changes nothing. Failed target validation,
denied Download permission or FlexLock retain last-good state.
Saved/draft configuration, deployment revisions and outstanding database
differences are not cleared by replay. Decommissioning invalidates managed AO
deployments and their replay eligibility. Recommission requires a fresh Full,
not Partial or replay, before those modules can operate again.
Cold power recovery cannot bypass that fresh-Full requirement.
Physical Network's **Re-send Last Good Managed AOs** replays every deployed
managed AO on the selected controller in one atomic update. Its named confirmation
captures exact last-good snapshots and membership; any changed transfer/scope,
invalid member or unavailable target aborts all replay. Scope follows deployed
ownership, not later database reassignments, and excludes newly saved modules
that have never been downloaded. It preserves newer saved/draft data, nominal
deployment/revisions and outstanding status differences. Each module restores
its last Full plus subsequently preserved Partial values rather than current
live values. Recommissioning still requires fresh Full. Existing opted-in restart
memory/staleness is not refreshed by replay; use the separate memory update.
Snapshots are session-local. These are bounded AO replay subsets, not a native
whole-controller full-plus-partial script, general controller-memory-only update,
workstation recovery or native persistent download script. Existing live
parameter NVM/restore flags remain a separate simulation.

In Physical Network, **Update AO Cold Restart Memory** atomically captures the
last successful transfers for managed AO modules assigned to that controller.
It requires an unlocked workstation and Download permission. It changes only
separate session-local restart snapshots and logs the update—not working
configuration, live outputs, saved defaults, bindings or revisions.
Later database edits are excluded. This explicitly opts those AO modules into
transfer-snapshot restart, consumed by Cold Restart Module and in-window power
recovery. Deployed parameter restore flags can still overlay live parameter NVM.
After another Partial download, refresh memory before restarting. A stale
snapshot rejects manual restart and inhibits power-recovered AO execution with
a diagnostic; a fresh Full is then required. Full downloads refresh opted-in
memory. Decommission clears eligibility. Unenrolled modules retain their prior
restart behavior. This is the p97 managed-AO subset, not a native full-controller
script, upgrade recovery or memory for PID/device/SFC/Setup Data.

Save persists only this AO configuration in the local browser profile; Load Saved
requires the module and its plant area to exist. Controller/card prerequisites
must be recreated before Download. Deployed state and simulated NVM remain
in-memory and do not survive browser reload. This is a synchronous, simulated,
single-module transfer, not native DeltaV communication or a whole-controller
download. PID_LOOP, devices and SFCs have their separate opt-in lifecycles;
unenrolled modules retain their existing immediately live behavior.
Area and Equipment Module membership stays project-level metadata; Save captures
current membership, and transfer/restart does not resurrect renamed/deleted parents.
Arbitrary typed parameters/paths, 4-20 mA scaling, discrete CAS, native templates,
custom faceplate templates and general saved/controller lifecycle remain gaps.

Explorer module properties now configure independent Primary Control and Detail
Display references. Created pictures open in Run mode; `Ovw_ref.grf` and
`alarmList.grf` retain their existing built-in routes. Assigned faceplates show
separate Primary/Detail navigation links without changing their control body.
Back/Forward restores the named picture, not just the generic builder screen.
Invalid/deleted references report an error and do not silently open a fallback.
These are project-level references; native faceplate-template assignment and
download-controlled display metadata are not implemented.

Display Builder now supports the course's `LI-101/AI1/PV.F_CV` and
`LEVEL-101/CAS_SP.F_CV` numeric datalinks. The Data Entry Expert enables
standalone AO Floating Point writes with explicit bounds; invalid, denied or
cancelled entries do not change runtime. Rectangle fills support vertical/
horizontal direction and either explicit limits or the source's live engineering
scale. Failed signals retain the real last-good value with Bad indication,
not the requested AO command. The new Tank Dynamo reuses approved artwork.
Save/Load Picture persists configuration in the browser profile, not a native
`.grf` file or controller download; source modules must exist before loading.
Existing datalinks/dynamos and approved plant graphics are unchanged.

Module creation in Explorer and Control Studio now enforces the course's
16-character naming rule and reports invalid/duplicate/denied creation without
false success. Existing protected equipment and graphics are unchanged.

Validate audit mapping with `node scripts\validate-dv09-audit.mjs` and
`node --test tests\dv09-audit.test.cjs`. These reference-specific checks require
the local `pdf_om.txt` extraction identified in the report, not bundled source
material. Zero unmapped lines proves traceability, **not feature coverage**.

Workshop checkmarks are a manual exercise checklist, **not verified coverage**.

## PID OOS and tracking LO

## DV-09 PID detail tuning and real-time trends

PID faceplates offer **Detail** online tuning when no custom detail picture is
assigned. Explicit custom detail assignments retain precedence. Shared Tune
controls preserve fractional RESET values (including the course's 2.5 seconds).
Tuning requires an unlocked workstation, the TUNING key, an executable PID and
finite nonnegative values. It changes runtime only; upload selected parameters
to save configured defaults.

Faceplate **Trend** opens PV/SP/requested OUT for any PID, including newly
created FIC-102. The historian samples all three together; the module selector
also supports AI PV and AO PV/SP/OUT. PV/SP use module engineering ranges, while
OUT uses 0-100%. PID output is not measured valve travel. The original six
default PV pens remain available. This is simulator-native detail/trending, not
the proprietary detail-picture template or historian.

From PID **Detail**, **Tune Process** offers simulator **Test / Review / Update**.
First select MAN and confirm good PV and applied-output feedback. Test records
PV and AO1 applied output while you request bounded manual output commands.
Use an explicitly configured process/tieback (for example FY-2 to FT-2 with the
course's deployed 2.6-second filter); an unchanged manual sensor is not an
output-driven process response. Review requires at least three ordered samples,
10 simulated seconds, a 0.1% applied output step and 0.001 engineering-unit PV
span. These are simulator validation thresholds, not native Tune specifications.
Recording is limited to five simulated minutes and a single connected AO in CAS.
Changed tuning/configuration/bindings/filter or Bad feedback invalidates the test.

Review the measured response, enter your own new GAIN/RESET/RATE and **Update
Tuning**. Update is online-only; save defaults through explicit parameter upload.
Manual output writes are operator commands and remain after Cancel/Close;
return output/mode explicitly through the faceplate. Test does not change mode
automatically, and cancellation does not update tuning.

Review also shows a **Suggested Tuning** calculated directly from the recorded
samples: process gain from the measured PV/output change, an apparent dead
time/time constant from the standard 10%/63.2% reaction-curve points, and the
classic Ziegler-Nichols open-loop PI rule (`Kc = 0.9*(T/(K*L))`, `Ti = L/0.3`,
`RATE` always 0). **Use Suggested Values** pre-fills the editable GAIN/RESET/
RATE fields; it does not apply them automatically, and every value can still be
reviewed or changed before Update Tuning. A collapsed response window or zero
net process gain reports a clear error rather than a fabricated number. This is
a transparent simulator calculation, not native DeltaV Tune system
identification, and is not claimed to match its proprietary algorithm.

Custom Builder valves also offer an independent **Actuator Color Animation**.
Use body AND conditions for confirmed pump running plus sampled valve-open
feedback; use `FIC-102 / AO1/OUT > 0` for applied-output actuator indication.
The two parts resolve shared colors and Bad/error quality independently.
Disable the actuator link to inherit body color. Both links persist in Picture
Save/Load. Applied output is a simulator proxy, not measured physical travel;
baseline plant symbols and colors remain unchanged.

## DV-09 PID_LOOP / FIC-102 template

Explorer's New Control Module form offers the course `PID_LOOP` template for
PID modules. It creates the FIC-102 configuration: 0-100 GPM, gain 0.5,
3-second/repeat reset, rate 0, reverse acting, increase-to-open IO option,
enabled LO10/HI90 alarms, AUTO normal mode and TANK101 primary display.
Control Studio binds its AI1 input to FT-2 and AO1 output to FY-2; manual
simulated FT-2 input is sampled as measured flow and the applied output is
written to the bound AO channel. Licensing Properties counts those physical
channels once each.

Control Studio's opt-in Saved PID_LOOP Lifecycle adds controller assignment,
validated Save/Load in the browser profile, an atomic Full simulated download,
and explicit Online/Offline controls. An unconfigured, dirty, stale, or
controller-mismatched record cannot be downloaded; the runtime remains OOS
until a current saved revision has been downloaded and placed Online. Physical
DeltaV controller communication and native project databases are not modeled.

For a downloaded PID_LOOP that is Online, `Upload Online Values` offers only
changed GAIN, RESET and RATE values. Selected values persist to the local saved
configuration while the running module remains unchanged. A later Full Download
prompts when retained online tuning differs; selections start empty, and
Download Only preserves the configured defaults. Cancelling either dialog does
not write values. This is the FIC-102 tuning subset, not general native module
upload or controller-database communication.

The same selected/none-safe pattern now also applies to standalone AO modules:
a downloaded AO's `Upload Selected Parameters` lists each Floating Point
parameter (e.g. `CAS_SP`) whose live value differs from the offline draft as
"name: draft X / live Y" with a checkbox. Selected values write into the draft
only; Save is still required to persist them, and every other draft field
(mode, SP, manual output, restart/download policy) and every unselected
parameter are untouched. Selecting none, Cancel, or an already-matching
selection is a safe no-op. The existing blanket `Upload to Draft` button is
unchanged and still available for a whole-module capture. This remains a
per-family selective mechanism, not a single generic upload across every
module/parameter type, and AO does not yet prompt at download time the way
PID_LOOP's Full Download does.

In the Display Builder, a FIC-102 `PID1/SP` datalink can use numeric entry
bounded by its engineering range. `PID1/MODE.A_TARGET` supports a multiple-item
selector constrained by `MODE.PERMITTED`; `MODE.A_ACTUAL` can be displayed
read-only. An `ALARMS[1].A_LAALM` datalink is hidden until the module has an
active simulator alarm. A `PID1/OUT` datalink can instead use **OUT Ramp**
entry: Raise/Lower pushbuttons held for a configured percent-per-second rate,
not typed numeric entry, matching the course's ramp data-entry type. Writes use
the same operator permission and PID lifecycle checks as the faceplate, and OUT
ramp additionally requires MAN/ROUT target mode outside LO/OOS like native PID
output entry. Separate valve-body/actuator animation is supported through
Shared Flow Color Animation below. Native DeltaV alarm-index semantics are not
claimed.

### Shared custom-picture flow colors

Builder's **User Flow Tables** configures two-color tables such as `flow_color`.
The **Pipe**, **Pump**, and **Valve** objects can opt into a table through
**Shared Flow Color Animation**. Every linked object resolves the shared table
live, including links in other pictures; changing a table does not copy colors
into individual objects. Existing plant graphics are not linked or recolored.
Straight pipe segments support horizontal/vertical placement with X/Y and
Width/Height; equipment dynamos reuse the approved shared silhouettes.
Connecting a Tank Dynamo, a motor-bound Pump and a PID/VALVE-bound Valve with
these shared-colored Pipe segments is this simulator's PipesAnim substitute for
the course's "Connect the TANK, PUMP and VALVES together using PipesAnim" step;
it is not the native DeltaV PipesAnim dynamo library or System Tree.

Each animation combines 1-8 greater-than conditions with AND. `STATE` reads
confirmed motor/valve feedback or DI/DO state; `AO1/OUT` reads the applied
simulator output, not measured valve travel. Missing sources/tables show an
explicit diagnostic. Bad feedback uses neutral quality indication rather than
claiming product flow or no-flow. Save/Load Tables and Save/Load Picture are
separate browser-profile actions; load required tables before linked pictures.
This models the p266 shared-color behavior, not the native System Tree or
complete ValveHorizontalControlD1/PipesAnim library.

PID1's Studio target selector exposes supported target modes; LO is actual-only.
OOS stops PID calculations and holds its requested output with Bad block
quality. AI1 keeps its own input quality. A normally cascaded AO holds Bad,
but an independently configured manual AO continues its own operation.

Enable tracking with a known independent trigger and a finite 0-100% constant
or a qualified live value source. A healthy nonzero trigger gives actual LO
without changing the target. Releasing it returns to the resolved target
bumplessly, including large proportional errors and derivative changes.
Missing/Bad tracking data holds applied output and displays a diagnostic.
Operator and SFC output assignments cannot override LO/OOS; workstation locks
also block operator mode, output and tracking changes.

Studio exposes PID `MODE.NORMAL`, `MODE.ISAN` and `MODE.PERMITTED`. Normal
is stored/readable but does not change the algorithm; ISAN reports whether
actual mode equals normal. Permitted target choices are stored on the live
PID module, editable as a multi-select, and enforced on operator and SFC writes.
The current target and Normal mode must remain permitted.
For custom pictures, a per-datalink option hides `MODE.A_ACTUAL` when actual
matches `MODE.NORMAL` and flashes it red otherwise; reduced-motion preference
keeps it visible in solid red. The shared course `flow_color` threshold table
and linked flow/pump/valve/piping animations are still missing.

SFC mode expressions accept names and the course's numeric codes: targets
OOS1/IMAN2/MAN8/AUTO16/CAS48/RCAS80/ROUT144; actual modes use LO4, CAS32,
RCAS64 and ROUT128. LO4 is not a target. Unsupported target masks reject.
Held Bad PV/OUT cannot satisfy numeric SFC transitions, including AO OOS.
This models the course mode fields, not the native packed mode mask, remote-
host communication or physical Fieldbus writes.

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
