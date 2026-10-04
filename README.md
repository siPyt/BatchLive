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
This is the supported algorithm-choice subset, not native dialog/template,
SFC description/equipment-membership or Save As parity.

Reset an existing sample SFC and choose **Use Save/Download lifecycle** to opt it into isolated
configured, saved and deployed linear algorithms. **Module Properties**
assigns its configured controller; **Save** validates/persists browser
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
unchanged. Full uses configured values; Partial selects configured values,
critical block values only, or critical plus user-defined values. The DV-09
CAS/500 versus AUTO/555 exercise produces CAS/500, AUTO/500 and AUTO/555 respectively.
Online shows runtime; offline edits do not alter the deployed module. Upload
copies live values into a draft, requiring explicit Save before persistence.
Cold restart restores selected values only when both deployed module and
parameter restore flags are set. Power recovery outside the configured cold
restart window requires a fresh Full Download, not just commissioning.

Save persists only this AO configuration in the local browser profile; Load Saved
requires the module and its plant area to exist. Controller/card prerequisites
must be recreated before Download. Deployed state and simulated NVM remain
in-memory and do not survive browser reload. This is a synchronous, simulated,
single-module transfer, not native DeltaV communication or a whole-controller
download. Other module types and unenrolled modules remain immediately live.
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
