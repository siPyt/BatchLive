import type { Controller } from './hardware'
import { controllerIsDown } from './hardware'
import type { LockType } from './security'

/** "What's This?" help for the controller lifecycle exercise (DV-09 pp55-67), with live prerequisites. */
export type ControllerHelpTopic =
  | 'identify' | 'commission' | 'decommission' | 'autoSense' | 'coldRestart' | 'redundant' | 'networkRedundant'
  | 'powerLoss' | 'restorePower' | 'applyProperties'

export interface HelpContext {
  controller: Controller
  /** Keys held by the logged-on user. */
  keys: ReadonlySet<LockType>
}

export interface Prerequisite { text: string; met: boolean }
export interface HelpEntry {
  title: string
  body: string
  /** Manual page the behaviour comes from. */
  source: string
  prerequisites: (ctx: HelpContext) => Prerequisite[]
}

const powered = (c: Controller): boolean => c.powerDownAt === null
const key = (ctx: HelpContext, lock: LockType, label: string): Prerequisite => ({ text: `You hold the ${label} key`, met: ctx.keys.has(lock) })

export const CONTROLLER_HELP: Record<ControllerHelpTopic, HelpEntry> = {
  identify: {
    title: 'Identify',
    body: 'Flashes the controller\'s indicators so a specific controller can be located on the network. It works on decommissioned and commissioned controllers. The state ends when you close the Identify dialog or choose Stop Flashing.',
    source: 'pp54-56',
    prerequisites: (ctx) => [{ text: 'The controller has power', met: powered(ctx.controller) }, key(ctx, 'DIAGNOSTIC', 'Diagnostic')]
  },
  commission: {
    title: 'Commission',
    body: 'Adds a decommissioned controller to the control network under its name with an assigned address. You are then offered Auto-sense I/O; answering No still commissions the controller, and you can auto-sense later.',
    source: 'pp57-59',
    prerequisites: (ctx) => [
      { text: 'The controller is decommissioned', met: !ctx.controller.commissioned },
      { text: 'The controller has power', met: powered(ctx.controller) },
      key(ctx, 'CAN_CONFIGURE', 'Can Configure'), key(ctx, 'CAN_DOWNLOAD', 'Can Download')
    ]
  },
  decommission: {
    title: 'Decommission',
    body: 'Makes a commissioned controller a non-active member of the control network, for example for a planned extended shutdown. Bound I/O goes Bad and managed modules lose their running download.',
    source: 'p54',
    prerequisites: (ctx) => [
      { text: 'The controller is commissioned', met: ctx.controller.commissioned },
      { text: 'The controller is running', met: ctx.controller.commissioned && !controllerIsDown(ctx.controller) },
      key(ctx, 'CAN_CONFIGURE', 'Can Configure')
    ]
  },
  autoSense: {
    title: 'Auto-sense I/O',
    body: 'The controller scans its I/O subsystem and identifies the card types and carrier slots where I/O cards are installed. It can be run at any time after commissioning.',
    source: 'p59',
    prerequisites: (ctx) => [
      { text: 'The controller is commissioned and running', met: ctx.controller.commissioned && !controllerIsDown(ctx.controller) },
      key(ctx, 'DIAGNOSTIC', 'Diagnostic')
    ]
  },
  coldRestart: {
    title: 'Cold Restart',
    body: 'After a power failure the controller downloads itself from its non-volatile memory when power returns in less than or equal to the cold restart time. Choose Always Disabled, Always Enabled (maximum time) or Enabled Within A Time Limit (0-30 days, 0-23 hours, 0-59 minutes); a time of 0 is Always Disabled. At least two minutes is recommended.',
    source: 'pp62-65',
    prerequisites: (ctx) => [
      { text: 'The controller has power', met: powered(ctx.controller) },
      { text: 'The controller is not failed while commissioned', met: !(ctx.controller.commissioned && controllerIsDown(ctx.controller)) },
      key(ctx, 'CAN_CONFIGURE', 'Can Configure')
    ]
  },
  redundant: {
    title: 'Redundant controller',
    body: 'Pairs the controller with a standby partner. The primary is ACTIVE and the secondary STANDBY; a primary failure switches to the secondary without a process upset.',
    source: 'p58',
    prerequisites: (ctx) => [{ text: 'The controller has power', met: powered(ctx.controller) }, key(ctx, 'CAN_CONFIGURE', 'Can Configure')]
  },
  networkRedundant: {
    title: 'Redundant control network',
    body: 'Enables both control network connections for the controller so a single network failure does not isolate it. Select it before commissioning, as in the workshop.',
    source: 'p58',
    prerequisites: (ctx) => [{ text: 'The controller has power', met: powered(ctx.controller) }, key(ctx, 'CAN_CONFIGURE', 'Can Configure')]
  },
  powerLoss: {
    title: 'Power Loss',
    body: 'Simulates losing power to the controller. All bound I/O goes Bad. Restore Power afterwards to see whether cold restart brings the controller back or it needs commissioning again.',
    source: 'pp62-65',
    prerequisites: (ctx) => [
      { text: 'The controller is commissioned and has power', met: ctx.controller.commissioned && powered(ctx.controller) },
      key(ctx, 'DIAGNOSTIC', 'Diagnostic')
    ]
  },
  restorePower: {
    title: 'Restore Power',
    body: 'Returns power to the controller. It cold-restarts if the outage was within the cold restart time; otherwise it returns decommissioned and needs commissioning and a download.',
    source: 'pp62-65',
    prerequisites: (ctx) => [{ text: 'Power has been lost', met: !powered(ctx.controller) }, key(ctx, 'DIAGNOSTIC', 'Diagnostic')]
  },
  applyProperties: {
    title: 'Apply Properties',
    body: 'Saves the redundancy, control network and cold restart settings shown beside it. Invalid values are rejected with a message and nothing changes.',
    source: 'pp57-65',
    prerequisites: (ctx) => [
      { text: 'The controller is not failed while commissioned', met: !(ctx.controller.commissioned && controllerIsDown(ctx.controller)) },
      { text: 'The controller has power', met: powered(ctx.controller) },
      key(ctx, 'CAN_CONFIGURE', 'Can Configure')
    ]
  }
}

export function helpFor(topic: ControllerHelpTopic, ctx: HelpContext): { entry: HelpEntry; prerequisites: Prerequisite[]; ready: boolean } {
  const entry = CONTROLLER_HELP[topic]
  const prerequisites = entry.prerequisites(ctx)
  return { entry, prerequisites, ready: prerequisites.every((p) => p.met) }
}
