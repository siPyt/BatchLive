import { useEffect, useState } from 'react'
import { useStore } from '../engine/store'
import { channelBad, traditionalChannels, type TraditionalCard, type TraditionalCardType,
  type TraditionalChannel } from '../engine/traditionalIo'

export function TraditionalIoPanel({ controllerTag }: { controllerTag: string }): JSX.Element {
  const hardware = useStore(s => s.hardware)
  const addCard = useStore(s => s.addTraditionalCard)
  const [slot, setSlot] = useState(1)
  const [type, setType] = useState<TraditionalCardType>('AI')
  const cards = Object.values(hardware.traditionalCards ?? {}).filter(card => card.controllerTag === controllerTag)
    .sort((a, b) => a.slot - b.slot)
  return (
    <section className="traditional-io" aria-label={`${controllerTag} traditional I/O`}>
      <div className="batch-panel-head">Traditional I/O Cards</div>
      <p className="traditional-note">
        Training inventory: eight slots, eight channels per card. Configure a DST and Enable each channel.
        DI/DO, standalone AI/AO and PID AI1/AO1/AO2 bindings execute on scans.
        Manual AI signals are engineering values; AO signals are percent output.
        Simulated AO-to-AI tiebacks use percent, converted through the receiving module's PV_SCALE.
        Electrical scaling and controller downloads are not implemented here;
        these settings are session-local and immediately live.
      </p>
      <div className="traditional-toolbar">
        <label>Slot <input aria-label={`${controllerTag} new card slot`} type="number" min={1} max={8}
          value={slot} onChange={e => setSlot(Number(e.target.value))} /></label>
        <label>Card type <select aria-label={`${controllerTag} new card type`} value={type}
          onChange={e => setType(e.target.value as TraditionalCardType)}>
          {(['AI', 'AO', 'DI', 'DO'] as const).map(value => <option key={value}>{value}</option>)}
        </select></label>
        <button className="tbtn sm" onClick={() => addCard(controllerTag, slot, type)}>New Card</button>
      </div>
      {cards.map(card => <div className="traditional-card" key={card.id}>
        <div className="exp-newmod-title">{card.id} — {card.type}</div>
        {card.channels.map(channel => <TraditionalChannelEditor key={channel.channel}
          card={card} channel={channel} />)}
      </div>)}
    </section>
  )
}

function TraditionalChannelEditor({ card, channel }: {
  card: TraditionalCard; channel: TraditionalChannel
}): JSX.Element {
  const hardware = useStore(s => s.hardware)
  const configure = useStore(s => s.configureTraditionalChannel)
  const simulateInput = useStore(s => s.setTraditionalInput)
  const [dst, setDst] = useState(channel.dst)
  const [enabled, setEnabled] = useState(channel.enabled)
  const [tieback, setTieback] = useState(channel.tiebackDst ?? '')
  const [value, setValue] = useState(channel.value)
  useEffect(() => {
    setDst(channel.dst); setEnabled(channel.enabled); setTieback(channel.tiebackDst ?? '')
  }, [channel.dst, channel.enabled, channel.tiebackDst])
  const label = `${card.id} CH${channel.channel}`
  const bad = channelBad(hardware, card, channel) || channel.bad
  const bindings = Object.entries(hardware.discreteBindings ?? {}).filter(([, bound]) => bound === channel.dst)
  const analogBindings = Object.entries(hardware.analogBindings ?? {}).flatMap(([tag, ports]) =>
    Object.entries(ports).filter(([, dst]) => dst === channel.dst).map(([port]) => `${tag}.${port}`))
  const isInput = card.type === 'DI' || card.type === 'AI'
  const sources = traditionalChannels(hardware).filter(item =>
    item.card.type === (card.type === 'AI' ? 'AO' : 'DO') && item.channel.dst)
  return (
    <details className="traditional-channel">
      <summary>
        <span>CH{channel.channel}: <b>{channel.dst || '(unnamed)'}</b></span>
        <span>{channel.enabled ? 'Enabled' : 'Disabled'} · {bad ? 'Bad' : 'Good'} · Signal {channel.value}
          {card.type === 'AO' || (card.type === 'AI' && channel.tiebackDst) ? ' %' :
            card.type === 'AI' ? ' (engineering)' : ''}</span>
      </summary>
      <div className="traditional-channel-form">
        <label>DST <input aria-label={`${label} DST`} value={dst}
          onChange={e => setDst(e.target.value)} placeholder="e.g. XV-1" /></label>
        <label><input aria-label={`${label} Enable`} type="checkbox" checked={enabled}
          onChange={e => setEnabled(e.target.checked)} /> Enable</label>
        {isInput && <label>Simulated tieback (not physical wiring)
          <select aria-label={`${label} simulated tieback`} value={tieback}
            onChange={e => setTieback(e.target.value)}>
            <option value="">(none — manual input)</option>
            {sources.map(item => <option key={item.channel.dst} value={item.channel.dst}>
              {item.channel.dst} ({item.card.id} CH{item.channel.channel})
            </option>)}
          </select>
        </label>}
        <button className="tbtn sm" onClick={() => configure(card.id, channel.channel,
          { dst, enabled, tiebackDst: tieback || undefined })}>Apply Channel Properties</button>
        <span>Module binding: {[...bindings.map(([tag]) => tag), ...analogBindings].join(', ') ||
          '(none — select IO_IN/IO_OUT in Control Studio)'}</span>
        {isInput && <div className="traditional-toolbar">
          <label>Simulated signal <input aria-label={`${label} simulated signal`} type="number"
            value={value} onChange={e => setValue(Number(e.target.value))} /></label>
          <button className="tbtn sm" disabled={!channel.dst || !!channel.tiebackDst}
            onClick={() => simulateInput(channel.dst, value)}>Set Simulated Input</button>
        </div>}
      </div>
    </details>
  )
}
