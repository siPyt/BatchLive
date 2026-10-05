const assert = require('node:assert/strict')
const fs = require('node:fs')
const test = require('node:test')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, filename)
}
const { useStore } = require('../src/renderer/src/engine/store.ts')
const { useSecurity } = require('../src/renderer/src/engine/security.ts')
const { findDst } = require('../src/renderer/src/engine/traditionalIo.ts')
const serial = require('../src/renderer/src/engine/serialIo.ts')

const CARD = 'CTRL1/C05'
const dataset = (over) => ({
  name: 'DS01', description: '', direction: 'OUTPUT', outputMode: 'COMPLETE_BLOCK', outputReadback: false,
  dataType: 'INT16', tag: 'FLOW-OUT', plcTable: 'HOLDING_REGISTERS', plcBase: 0, plcOffset: 0, count: 1, ...over
})

function fixture(run) {
  const before = { store: useStore.getState(), security: useSecurity.getState(), window: global.window }
  const local = new Map()
  global.window = { alerts: [], alert(m) { this.alerts.push(m) }, localStorage: { getItem: (k) => local.get(k) ?? null, setItem: (k, v) => local.set(k, String(v)) } }
  try {
    useSecurity.setState({ currentUser: 'admin', locked: false, lockAssignments: {}, workstation: null })
    const s = useStore.getState()
    s.newProject('blank')
    assert.equal(s.createArea('PLANT_AREA_A'), true)
    assert.equal(s.createController('CTRL1', 'Serial fixture'), true)
    assert.equal(s.commissionController('CTRL1'), true)
    assert.equal(s.addSerialCard('CTRL1', 5), null)
    run(s)
  } finally {
    useStore.setState(before.store, true)
    useSecurity.setState(before.security, true)
    if (before.window === undefined) delete global.window
    else global.window = before.window
  }
}

const hw = () => useStore.getState().hardware
const card = () => hw().serialCards[CARD]
const dst = (name) => findDst(hw(), name)
const ok = (result, message) => assert.equal(result, null, message ?? String(result))

/** Workshop 1: master port 1 / slave port 2 tied back, DEV01 at address 1 with the four datasets. */
function workshop(s, over = {}) {
  ok(s.configureSerialPort(CARD, 'P01', { enabled: true, protocol: 'RTU', mode: 'MASTER', retryCount: 1, timeoutMs: 1000, transmitDelayMs: 0, portType: 'RS232', baud: 9600, parity: 'EVEN', dataBits: 8, stopBits: 1, ...over }))
  ok(s.configureSerialPort(CARD, 'P02', { enabled: true, protocol: 'RTU', mode: 'SLAVE', transmitDelayMs: 0, portType: 'RS232', baud: 9600, parity: 'EVEN', dataBits: 8, stopBits: 1 }))
  ok(s.configureSerialCard(CARD, { tieback: true }))
  for (const port of ['P01', 'P02']) ok(s.addSerialDevice(CARD, port, 'DEV01', 1))
  const sets = [
    ['P01', dataset({ name: 'DS01', tag: 'FLOW-OUT' })],
    ['P01', dataset({ name: 'DS02', tag: 'MTR-OUT', dataType: 'BOOLEAN', plcTable: 'COILS', plcOffset: 1 })],
    ['P02', dataset({ name: 'DS01', tag: 'FLOW-IN', direction: 'INPUT' })],
    ['P02', dataset({ name: 'DS02', tag: 'MTR-IN', direction: 'INPUT', dataType: 'BOOLEAN', plcTable: 'COILS', plcOffset: 1 })]
  ]
  for (const [port, ds] of sets) ok(s.saveSerialDataset(CARD, port, 'DEV01', ds))
  ok(s.downloadSerialCard(CARD))
}

function run(s, seconds) {
  useStore.setState({ running: true })
  for (let i = 0; i < Math.round(seconds / 0.1); i++) s.tick(0.1)
}

test('DV09-086 addressing: Modbus reference numbers, data tables and value encoding', () => {
  assert.equal(serial.modbusAddress({ plcTable: 'COILS', plcBase: 0, plcOffset: 1 }), 2)
  assert.equal(serial.modbusAddress({ plcTable: 'HOLDING_REGISTERS', plcBase: 0, plcOffset: 0 }), 40001)
  assert.equal(serial.modbusAddress({ plcTable: 'INPUT_STATUS', plcBase: 0, plcOffset: 0 }), 10001)
  assert.equal(serial.modbusAddress({ plcTable: 'INPUT_REGISTERS', plcBase: 9, plcOffset: 1 }, 2), 30013)
  assert.equal(serial.datasetDstName(dataset({ tag: 'FLOW-IN' }), 0), 'FLOW-IN/R40001')
  assert.equal(serial.datasetDstName(dataset({ tag: 'X', dataType: 'FLOAT32', count: 3 }), 2), 'X/R40005', 'floats take two registers each')
  for (const [type, value] of [['INT16', -1234], ['INT16', 32767], ['UINT16', 65535], ['DISCRETE', 200], ['BOOLEAN', 1]]) {
    assert.equal(serial.decodeValue(type, serial.encodeValue(type, value)), value, `${type} ${value}`)
  }
  assert.equal(serial.decodeValue('INT16', serial.encodeValue('INT16', 99999)), 32767, 'out of range clamps')
  assert.ok(Math.abs(serial.decodeValue('FLOAT32', serial.encodeValue('FLOAT32', 12.345)) - 12.345) < 1e-5)
  assert.equal(serial.encodeValue('FLOAT32', 1).length, 2)
  assert.equal(serial.SERIAL_LIMITS.devicesPerPort, 16)
  assert.equal(serial.SERIAL_LIMITS.datasetsPerPort, 16)
  assert.equal(serial.SERIAL_LIMITS.valuesPerDataset, 100)
})

test('DV09-086/087 card, slot and port-setting validation with specific messages', () => fixture((s) => {
  assert.match(s.addSerialCard('CTRL1', 5), /already has a card/)
  assert.match(s.addSerialCard('CTRL1', 9), /slot must be 1-8/)
  assert.match(s.addSerialCard('NOPE', 1), /does not exist/)
  assert.equal(s.addSerialCard('CTRL1', 6, true), null, 'a placeholder can be configured before the card is installed')
  assert.equal(hw().serialCards['CTRL1/C06'].placeholder, true)
  assert.match(s.configureSerialPort(CARD, 'P01', { retryCount: -1 }), /retry count/)
  assert.match(s.configureSerialPort(CARD, 'P01', { retryCount: 11 }), /retry count/)
  assert.match(s.configureSerialPort(CARD, 'P01', { timeoutMs: 50 }), /time out/)
  assert.match(s.configureSerialPort(CARD, 'P01', { transmitDelayMs: -5 }), /transmit delay/)
  assert.match(s.configureSerialPort(CARD, 'P01', { baud: 1234 }), /baud rate/)
  assert.match(s.configureSerialPort(CARD, 'P01', { parity: 'MARK' }), /parity/)
  assert.match(s.configureSerialPort(CARD, 'P01', { dataBits: 5 }), /data bits/)
  assert.match(s.configureSerialPort(CARD, 'P01', { stopBits: 3 }), /stop bits/)
  assert.match(s.configureSerialPort(CARD, 'P01', { protocol: 'RTU', dataBits: 7 }), /RTU requires 8 data bits/)
  assert.equal(s.configureSerialPort(CARD, 'P01', { protocol: 'ASCII', dataBits: 7 }), null)
  assert.match(s.configureSerialPort(CARD, 'P01', { portType: 'WIFI' }), /port type/)
  assert.equal(card().configured.ports.P01.baud, 9600, 'rejected edits change nothing')
  assert.match(s.configureSerialCard(CARD, { capacity: 'HUGE' }), /DST or SCADA/)
}))

test('DV09-086 device limits: 16 per RS422/485 port, one per RS232 port, unique addresses 1-247', () => fixture((s) => {
  ok(s.addSerialDevice(CARD, 'P01', 'DEV01', 1))
  assert.match(s.addSerialDevice(CARD, 'P01', 'DEV02', 2), /single serial device/)
  ok(s.configureSerialPort(CARD, 'P01', { portType: 'RS422_485_HALF' }))
  assert.match(s.addSerialDevice(CARD, 'P01', 'DEV02', 1), /Address 1 is already used/)
  assert.match(s.addSerialDevice(CARD, 'P01', 'DEV02', 0), /1 to 247/)
  assert.match(s.addSerialDevice(CARD, 'P01', 'DEV02', 248), /1 to 247/)
  assert.match(s.addSerialDevice(CARD, 'P01', 'DEV01', 9), /already exists/)
  for (let i = 2; i <= 16; i++) ok(s.addSerialDevice(CARD, 'P01', `DEV${String(i).padStart(2, '0')}`, i))
  assert.match(s.addSerialDevice(CARD, 'P01', 'DEV17', 17), /At most 16 devices/)
  assert.match(s.configureSerialPort(CARD, 'P01', { portType: 'RS232' }), /single serial device/)
}))

test('DV09-088 datasets: direction/type/table rules, 100 values, overlap and unique tags', () => fixture((s) => {
  ok(s.addSerialDevice(CARD, 'P01', 'DEV01', 1))
  const add = (over) => s.saveSerialDataset(CARD, 'P01', 'DEV01', dataset(over))
  assert.match(add({ count: 0 }), /1 to 100/)
  assert.match(add({ count: 101 }), /1 to 100/)
  assert.match(add({ tag: 'lower' }), /upper case/)
  assert.match(add({ dataType: 'BOOLEAN' }), /need an integer/)
  assert.match(add({ plcTable: 'COILS' }), /single bits/)
  assert.match(add({ plcTable: 'INPUT_REGISTERS' }), /read-only in the PLC/)
  assert.match(add({ plcTable: 'INPUT_STATUS', dataType: 'BOOLEAN' }), /read-only in the PLC/)
  assert.match(add({ plcBase: 9990, count: 20 }), /past the end/)
  ok(add({ name: 'DS01', tag: 'OUT-A', count: 10, plcOffset: 0 }))
  assert.match(add({ name: 'DS02', tag: 'OUT-B', count: 5, plcOffset: 8 }), /overlaps DS01/, 'output datasets must not overlap')
  assert.match(add({ name: 'DS02', tag: 'OUT-A', plcOffset: 50 }), /already used/)
  assert.match(add({ name: 'DS01', tag: 'OUT-C', plcOffset: 50 }), /already exists/)
  ok(add({ name: 'DS02', tag: 'OUT-B', count: 5, plcOffset: 10 }))
  ok(s.saveSerialDataset(CARD, 'P01', 'DEV01', dataset({ name: 'DS02', tag: 'OUT-B', count: 7, plcOffset: 10 }), 'DS02'), 'editing keeps the same dataset')
  assert.equal(card().configured.ports.P01.devices.DEV01.datasets.DS02.count, 7)
  assert.match(s.removeSerialDataset(CARD, 'P01', 'DEV01', 'NOPE'), /does not exist/)
  ok(s.removeSerialDataset(CARD, 'P01', 'DEV01', 'DS02'))
}))

test('DV09-086 resource limits: 16 datasets per port and 500 DSTs versus 3200 SCADA points', () => fixture((s) => {
  ok(s.configureSerialPort(CARD, 'P01', { portType: 'RS422_485_FULL' }))
  ok(s.addSerialDevice(CARD, 'P01', 'DEV01', 1))
  for (let i = 1; i <= 5; i++) ok(s.saveSerialDataset(CARD, 'P01', 'DEV01', dataset({ name: `DS${i}`, tag: `BLK-${i}`, direction: 'INPUT', count: 100, plcBase: (i - 1) * 100 })))
  assert.equal(serial.serialDstCount(card().configured), 500)
  assert.match(s.saveSerialDataset(CARD, 'P01', 'DEV01', dataset({ name: 'DS6', tag: 'BLK-6', direction: 'INPUT', count: 1, plcBase: 500 })), /limited to 500 DSTs/)
  ok(s.configureSerialCard(CARD, { capacity: 'SCADA' }))
  ok(s.saveSerialDataset(CARD, 'P01', 'DEV01', dataset({ name: 'DS6', tag: 'BLK-6', direction: 'INPUT', count: 100, plcBase: 500 })))
  assert.match(s.configureSerialCard(CARD, { capacity: 'DST' }), /limit is 500/)
  for (let i = 7; i <= 16; i++) ok(s.saveSerialDataset(CARD, 'P01', 'DEV01', dataset({ name: `DS${i}`, tag: `BLK-${i}`, direction: 'INPUT', count: 1, plcBase: 600 + i })))
  assert.match(s.saveSerialDataset(CARD, 'P01', 'DEV01', dataset({ name: 'DS17', tag: 'BLK-17', direction: 'INPUT', count: 1, plcBase: 900 })), /At most 16 datasets/)
}))

test('DV09-090/091 workshop 1 configuration: card download publishes the four dataset DSTs with their types', () => fixture((s) => {
  assert.equal(dst('FLOW-OUT/R40001'), undefined, 'nothing is published before the download')
  workshop(s)
  assert.equal(dst('FLOW-OUT/R40001').card.type, 'AO')
  assert.equal(dst('MTR-OUT/R2').card.type, 'DO')
  assert.equal(dst('FLOW-IN/R40001').card.type, 'AI')
  assert.equal(dst('MTR-IN/R2').card.type, 'DI')
  assert.equal(card().placeholder, false)
  assert.ok(card().deployed)
  ok(s.configureSerialPort(CARD, 'P01', { retryCount: 4 }))
  assert.equal(card().deployed.ports.P01.retryCount, 1, 'edits stay configured until the next download')
}))

test('DV09-090 download requires a commissioned controller, valid settings and the Can Download key', () => fixture((s) => {
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.match(s.downloadSerialCard(CARD), /Can Download/)
  useSecurity.setState({ currentUser: 'admin' })
  s.decommissionController('CTRL1')
  assert.match(s.downloadSerialCard(CARD), /Commission controller/)
  assert.match(s.downloadSerialCard('NOPE'), /does not exist/)
}))

test('DV09-092 MTR-MODBUS: start/stop moves the coil across the tie-back and back as feedback', () => fixture((s) => {
  workshop(s)
  run(s, 3)
  assert.equal(s.createModule({ tag: 'MTR-MODBUS', type: 'MOTOR', area: 'PLANT_AREA_A', description: 'Pump on Modbus coils' }), true)
  assert.equal(s.enableDeviceLifecycle('MTR-MODBUS'), true)
  assert.equal(s.editDeviceDraft('MTR-MODBUS', { controllerTag: 'CTRL1', inputDst: 'MTR-IN/R2', outputDst: 'MTR-OUT/R2', resetRequired: false }), true)
  assert.equal(s.saveDeviceConfiguration('MTR-MODBUS'), true)
  assert.equal(s.downloadDeviceConfiguration('MTR-MODBUS'), true)
  assert.equal(s.setDeviceOnline('MTR-MODBUS', true), true)
  run(s, 2)
  s.startMotor('MTR-MODBUS')
  run(s, 2)
  assert.equal(card().runtime.memory.P02['1']['COILS:1'], 1, 'the master wrote coil 00002 at device address 1')
  assert.equal(dst('MTR-IN/R2').channel.value, 1, 'the slave dataset publishes the coil as MTR-IN')
  assert.equal(useStore.getState().modules['MTR-MODBUS'].running, true, 'the motor sees its run feedback')
  s.stopMotor('MTR-MODBUS')
  run(s, 2)
  assert.equal(card().runtime.memory.P02['1']['COILS:1'], 0)
  assert.equal(dst('MTR-IN/R2').channel.value, 0)
  assert.equal(useStore.getState().modules['MTR-MODBUS'].running, false)
}))

test('DV09-093 FIC-MODBUS: the loop reads and writes holding register 40001 through the virtual PLC and controls', () => fixture((s) => {
  workshop(s)
  run(s, 3)
  assert.equal(s.createModule({ tag: 'FIC-MODBUS', type: 'PID', templateId: 'PID_LOOP', area: 'PLANT_AREA_A', description: 'MODBUS loop' }), true)
  assert.equal(s.bindAnalogDst('FIC-MODBUS', 'input', 'FLOW-IN/R40001'), true)
  assert.equal(s.bindAnalogDst('FIC-MODBUS', 'output', 'FLOW-OUT/R40001'), true)
  assert.equal(s.enablePidLifecycle('FIC-MODBUS'), true)
  assert.equal(s.savePidConfiguration('FIC-MODBUS'), true)
  assert.equal(s.downloadPidModule('FIC-MODBUS'), true)
  assert.equal(s.setPidLifecycleOnline('FIC-MODBUS', true), true)
  useStore.setState({ running: true })
  s.setMode('FIC-MODBUS', 'MAN')
  run(s, 0.5)
  s.setOutput('FIC-MODBUS', 40)
  run(s, 3)
  assert.equal(card().runtime.memory.P02['1']['HOLDING_REGISTERS:0'], 40, 'OUT reached register 40001')
  assert.equal(dst('FLOW-IN/R40001').channel.value, 40)
  assert.equal(useStore.getState().modules['FIC-MODBUS'].pv, 40, 'the PV is the register read back through the slave')
  s.setSetpoint('FIC-MODBUS', 25)
  s.setMode('FIC-MODBUS', 'AUTO')
  run(s, 60)
  const loop = useStore.getState().modules['FIC-MODBUS']
  assert.ok(Math.abs(loop.pv - 25) < 2, `closed loop settles near SP, PV=${loop.pv}`)
  assert.equal(loop.pvBad, false)
}))

test('DV09-087 a failing link goes Bad only after (retry count + 1) x message time out; Good data returns on recovery', () => fixture((s) => {
  workshop(s, { retryCount: 1, timeoutMs: 1000 })
  run(s, 3)
  const statuses = () => ['DS01', 'DS02'].map((name) => card().runtime.ports.P01.status[`P01/DEV01/${name}`])
  assert.deepEqual(statuses(), ['GOOD', 'GOOD'])
  assert.equal(dst('FLOW-OUT/R40001').channel.bad, false)
  const broken = JSON.parse(JSON.stringify(card()))
  broken.deployed.ports.P02.enabled = false
  useStore.setState((st) => ({ hardware: { ...st.hardware, serialCards: { ...st.hardware.serialCards, [CARD]: broken } } }))
  let firstBad = null
  for (let i = 1; i <= 80 && firstBad === null; i++) {
    s.tick(0.1)
    if (statuses().includes('BAD')) firstBad = i / 10
  }
  assert.ok(firstBad >= 2 && firstBad <= 2.3, `first attempt plus one retry take 2000 ms, Bad at ${firstBad}s`)
  run(s, 5)
  assert.deepEqual(statuses(), ['BAD', 'BAD'])
  assert.equal(dst('FLOW-OUT/R40001').channel.bad, true)
  assert.equal(dst('FLOW-IN/R40001').channel.bad, true, 'a disabled slave port never reports good data')
  const healed = JSON.parse(JSON.stringify(card()))
  healed.deployed.ports.P02.enabled = true
  useStore.setState((st) => ({ hardware: { ...st.hardware, serialCards: { ...st.hardware.serialCards, [CARD]: healed } } }))
  run(s, 3)
  assert.deepEqual(statuses(), ['GOOD', 'GOOD'])
}))
test('DV09-087 retry count zero fails after a single time out', () => fixture((s) => {
  workshop(s, { retryCount: 0, timeoutMs: 500 })
  run(s, 1)
  assert.equal(card().runtime.ports.P01.status['P01/DEV01/DS01'], 'GOOD')
  const broken = JSON.parse(JSON.stringify(card()))
  broken.deployed.ports.P02.devices.DEV01.address = 2
  useStore.setState((st) => ({ hardware: { ...st.hardware, serialCards: { ...st.hardware.serialCards, [CARD]: broken } } }))
  run(s, 0.4)
  assert.equal(card().runtime.ports.P01.status['P01/DEV01/DS01'], 'GOOD')
  run(s, 0.8)
  assert.equal(card().runtime.ports.P01.status['P01/DEV01/DS01'], 'BAD', 'no slave device answers address 1')
}))

test('DV09-087 mismatched communication settings or a missing tie-back never exchange good data', () => fixture((s) => {
  ok(s.configureSerialPort(CARD, 'P01', { enabled: true, mode: 'MASTER', baud: 9600 }))
  ok(s.configureSerialPort(CARD, 'P02', { enabled: true, mode: 'SLAVE', baud: 19200 }))
  ok(s.configureSerialCard(CARD, { tieback: true }))
  for (const port of ['P01', 'P02']) ok(s.addSerialDevice(CARD, port, 'DEV01', 1))
  ok(s.saveSerialDataset(CARD, 'P01', 'DEV01', dataset({ name: 'DS01', tag: 'FLOW-OUT' })))
  ok(s.saveSerialDataset(CARD, 'P02', 'DEV01', dataset({ name: 'DS01', tag: 'FLOW-IN', direction: 'INPUT' })))
  ok(s.downloadSerialCard(CARD))
  run(s, 6)
  assert.equal(card().runtime.ports.P01.status['P01/DEV01/DS01'], 'BAD', 'baud mismatch')
  assert.equal(card().runtime.ports.P02.status['P02/DEV01/DS01'], 'BAD')
  assert.equal(dst('FLOW-IN/R40001').channel.bad, true)
  ok(s.configureSerialPort(CARD, 'P02', { baud: 9600 }))
  ok(s.configureSerialCard(CARD, { tieback: false }))
  ok(s.downloadSerialCard(CARD))
  run(s, 6)
  assert.equal(card().runtime.ports.P01.status['P01/DEV01/DS01'], 'BAD', 'no tie-back cable')
  ok(s.configureSerialCard(CARD, { tieback: true }))
  ok(s.configureSerialPort(CARD, 'P02', { mode: 'MASTER' }))
  ok(s.downloadSerialCard(CARD))
  run(s, 6)
  assert.equal(card().runtime.ports.P01.status['P01/DEV01/DS01'], 'BAD', 'two masters cannot talk')
}))

test('DV09-087/088 complete-block versus single-value outputs and output read-back', () => fixture((s) => {
  ok(s.configureSerialPort(CARD, 'P01', { enabled: true, mode: 'MASTER', sendOutputsOnStartup: false }))
  ok(s.configureSerialPort(CARD, 'P02', { enabled: true, mode: 'SLAVE' }))
  ok(s.configureSerialCard(CARD, { tieback: true }))
  for (const port of ['P01', 'P02']) ok(s.addSerialDevice(CARD, port, 'DEV01', 1))
  ok(s.saveSerialDataset(CARD, 'P01', 'DEV01', dataset({ name: 'BLK', tag: 'BLOCK', count: 3, outputMode: 'COMPLETE_BLOCK' })))
  ok(s.saveSerialDataset(CARD, 'P01', 'DEV01', dataset({ name: 'SNG', tag: 'SINGLE', count: 3, outputMode: 'SINGLE_VALUE', plcOffset: 10, outputReadback: true })))
  ok(s.saveSerialDataset(CARD, 'P02', 'DEV01', dataset({ name: 'BLKIN', tag: 'BLOCK-IN', count: 3, direction: 'INPUT' })))
  ok(s.saveSerialDataset(CARD, 'P02', 'DEV01', dataset({ name: 'SNGIN', tag: 'SINGLE-IN', count: 3, direction: 'INPUT', plcOffset: 10 })))
  ok(s.downloadSerialCard(CARD))
  const set = (name, value) => useStore.setState((st) => {
    const cards = { ...st.hardware.traditionalCards }
    for (const [id, c] of Object.entries(cards)) {
      if (c.channels.some((ch) => ch.dst === name)) cards[id] = { ...c, channels: c.channels.map((ch) => ch.dst === name ? { ...ch, value } : ch) }
    }
    return { hardware: { ...st.hardware, traditionalCards: cards } }
  })
  run(s, 1)
  const mem = () => card().runtime.memory.P02['1'] ?? {}
  assert.equal(mem()['HOLDING_REGISTERS:0'], undefined, 'send outputs on startup off: unchanged values are not sent')
  set('BLOCK/R40002', 55)
  run(s, 1)
  assert.deepEqual([mem()['HOLDING_REGISTERS:0'], mem()['HOLDING_REGISTERS:1'], mem()['HOLDING_REGISTERS:2']], [0, 55, 0], 'complete block sends every value when one changes')
  set('SINGLE/R40012', 7)
  run(s, 1)
  assert.equal(mem()['HOLDING_REGISTERS:11'], 7)
  assert.equal(mem()['HOLDING_REGISTERS:10'], undefined, 'single-value mode sends only the changed value')
  assert.equal(dst('BLOCK-IN/R40002').channel.value, 55, 'the slave input dataset receives the block')
  const forced = JSON.parse(JSON.stringify(card()))
  forced.runtime.memory.P02['1']['HOLDING_REGISTERS:11'] = 99
  useStore.setState((st) => ({ hardware: { ...st.hardware, serialCards: { ...st.hardware.serialCards, [CARD]: forced } } }))
  run(s, 1)
  assert.equal(dst('SINGLE/R40012').channel.value, 99, 'output read-back updates the DeltaV value when the PLC changes it')
}))

test('DV09-087 send outputs on startup transmits current output values after a download', () => fixture((s) => {
  workshop(s)
  run(s, 1)
  assert.equal(card().runtime.memory.P02['1']['HOLDING_REGISTERS:0'], 0, 'the initial value was sent without a change')
  assert.equal(card().runtime.memory.P02['1']['COILS:1'], 0)
}))

test('DV09-090 removing a serial card is refused while a module is bound to one of its DSTs', () => fixture((s) => {
  workshop(s)
  assert.equal(s.createModule({ tag: 'LOOP', type: 'PID', templateId: 'PID_LOOP', area: 'PLANT_AREA_A', description: 'x' }), true)
  assert.equal(s.bindAnalogDst('LOOP', 'input', 'FLOW-IN/R40001'), true)
  assert.match(s.removeSerialCard(CARD), /bound to a module/)
  assert.equal(s.bindAnalogDst('LOOP', 'input', ''), true)
  ok(s.removeSerialCard(CARD))
  assert.equal(dst('FLOW-IN/R40001'), undefined)
}))

test('DV09-089 serial dataset values cannot be forced with the traditional input simulator', () => fixture((s) => {
  workshop(s)
  assert.equal(s.setTraditionalInput('FLOW-IN/R40001', 5), false)
  assert.ok(global.window.alerts.some((m) => /cannot be simulated/.test(m)))
}))

test('DV09-086 serial configuration requires the Can Configure key', () => fixture((s) => {
  useSecurity.setState({ currentUser: 'OperatorA' })
  assert.match(s.configureSerialPort(CARD, 'P01', { enabled: true }), /Can Configure/)
  assert.match(s.addSerialDevice(CARD, 'P01', 'DEV01', 1), /Can Configure/)
  assert.match(s.addSerialCard('CTRL1', 6), /Can Configure/)
}))
