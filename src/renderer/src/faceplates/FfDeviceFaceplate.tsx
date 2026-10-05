import { useStore } from '../engine/store'
import { useUi } from '../ui/uiStore'
import { useSecurity } from '../engine/security'
import * as act from '../engine/fieldbusActions'
import { DEVICE_ALARM_KINDS, catalogEntry, deviceComm, type DeviceAlarmKind } from '../engine/fieldbus'
import { DEVICE_ALARM_LABEL, deviceAlarmArea, deviceAlarmCondition, deviceAlarmId, findFfDevice } from '../engine/deviceAlarms'
import { useState } from 'react'

/** FFDEV_FP: the faceplate of a FOUNDATION fieldbus device with its device alarms and settings. */
export function FfDeviceFaceplate({ tag, x, y }: { tag: string; x: number; y: number }): JSX.Element | null {
  const hardware = useStore((s) => s.hardware)
  const modules = useStore((s) => s.modules)
  const alarms = useStore((s) => s.alarms)
  const ackAlarm = useStore((s) => s.ackAlarm)
  const close = useUi((s) => s.closeFaceplate)
  const found = findFfDevice(hardware, tag)
  const canConfigure = useSecurity((s) => s.hasLock('CAN_CONFIGURE'))
  const [message, setMessage] = useState<string | null>(null)
  if (!found) return null
  const { card, device } = found
  const entry = catalogEntry(device.catalogId)
  const physical = device.deviceId ? card.field[device.deviceId] : undefined
  const area = deviceAlarmArea(hardware, modules, tag)
  const report = (result: string | null): void => setMessage(result)
  return (
    <div className="faceplate" style={{ left: x, top: y, position: 'absolute', zIndex: 30 }} role="dialog" aria-label={`FFDEV_FP ${tag}`} data-ffdev-faceplate={tag}>
      <div className="fp-title">
        <b>{tag}</b> <span>FFDEV_FP</span>
        <button className="tbtn sm" onClick={() => close(tag)} aria-label="Close faceplate">✕</button>
      </div>
      <div className="fp-row">{entry?.model} · {device.state} · address {device.address} · {deviceComm(card, device.port, device) ? 'communicating' : 'not communicating'}</div>
      <div className="fp-row">Alarm area: {area ?? 'none'} · Device alarms {card.deviceAlarms ? 'enabled' : 'disabled'}</div>
      {device.alarms.primaryDisplay && <div className="fp-row">Primary display: {device.alarms.primaryDisplay}</div>}
      <table className="exp-table">
        <thead><tr><th>Alarm</th><th>State</th><th>Priority</th><th>Enabled</th><th /></tr></thead>
        <tbody>
          {DEVICE_ALARM_KINDS.map((kind: DeviceAlarmKind) => {
            const setting = device.alarms.settings[kind]
            const alarm = alarms.find((a) => a.id === deviceAlarmId(tag, kind))
            const condition = deviceAlarmCondition(card, device, device.port, kind, hardware)
            return (
              <tr key={kind} data-device-alarm-row={kind}>
                <td>{DEVICE_ALARM_LABEL[kind]}</td>
                <td>{alarm ? `${alarm.active ? 'Active' : 'Normal (RTN)'}${alarm.acknowledged ? ', acknowledged' : ''}${alarm.repeats ? `, repeated ${alarm.repeats}x` : ''}` : setting.enabled ? (condition.blockedBy ?? 'Normal') : 'Disabled'}</td>
                <td>
                  <input aria-label={`${kind} priority`} type="number" min={4} max={15} value={setting.rank} disabled={!canConfigure} onChange={(e) => report(act.configureDeviceAlarm(card.id, tag, kind, { rank: Number(e.target.value) }))} />
                </td>
                <td><input aria-label={`${kind} enabled`} type="checkbox" checked={setting.enabled} disabled={!canConfigure} onChange={(e) => report(act.configureDeviceAlarm(card.id, tag, kind, { enabled: e.target.checked }))} /></td>
                <td>{alarm && alarm.active && !alarm.acknowledged && <button className="tbtn sm" onClick={() => ackAlarm(alarm.id)}>Ack</button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="traditional-channel-form">
        <label><input type="checkbox" aria-label="Enable Device Alarms" checked={card.deviceAlarms} disabled={!canConfigure} onChange={(e) => report(act.enableDeviceAlarms(card.id, e.target.checked))} /> Enable Device Alarms</label>
        <label>
          Area from{' '}
          <select aria-label="Device alarm area source" value={device.alarms.areaMode} disabled={!canConfigure} onChange={(e) => report(act.setDeviceAlarmArea(card.id, tag, e.target.value as 'CONTROLLER' | 'MODULE', device.alarms.areaModule ?? Object.keys(modules)[0]))}>
            <option value="CONTROLLER">Controller</option>
            <option value="MODULE">Module</option>
          </select>
        </label>
        {device.alarms.areaMode === 'MODULE' && (
          <select aria-label="Device alarm area module" value={device.alarms.areaModule ?? ''} disabled={!canConfigure} onChange={(e) => report(act.setDeviceAlarmArea(card.id, tag, 'MODULE', e.target.value))}>
            {Object.keys(modules).map((m) => <option key={m}>{m}</option>)}
          </select>
        )}
        <label>
          <input type="checkbox" aria-label="Repeat annunciation" checked={device.alarms.reannunciate} disabled={!canConfigure} onChange={(e) => report(act.setDeviceReannunciation(card.id, tag, e.target.checked, device.alarms.reannounceSeconds))} /> Repeat annunciation{entry?.reannunciation ? '' : ' (not supported by this device)'}
        </label>
        {physical && (
          <div data-field-faults>
            Simulated device condition:{' '}
            {(['failed', 'maintenance', 'advisory', 'abnormal'] as const).map((flag) => (
              <label key={flag} style={{ marginRight: 8 }}>
                <input type="checkbox" aria-label={`Device ${flag}`} checked={physical.faults[flag]} onChange={(e) => report(act.setFieldDevice(card.id, physical.id, { faults: { [flag]: e.target.checked } }))} /> {flag}
              </label>
            ))}
          </div>
        )}
        {message && <p role="alert">{message}</p>}
      </div>
    </div>
  )
}
