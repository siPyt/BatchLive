import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_HASH = '2170d28866a1f82a5930de5e900702888bf0de4a3dfdbff5919422fee4145b61'
const STATUSES = new Set(['CONTEXT', 'VERIFIED_SUBSET', 'PARTIAL', 'MISSING', 'BOUNDARY'])

export function buildAuditLedger(source, report) {
  const groups = [...report.matchAll(
    /^\[(DV09-\d{3})\]\r?\nPages: (\d+)-(\d+)\r?\nStatus: ([A-Z_]+)\r?\n/gm
  )].map(match => ({
    id: match[1], first: Number(match[2]), last: Number(match[3]), status: match[4]
  }))
  const headings = [...report.matchAll(/^\[(DV09-\d{3})\]\r?$/gm)]
  if (!groups.length || headings.length !== groups.length) {
    throw new Error('Every audit group must have valid Pages and Status fields')
  }
  const ids = new Set()
  const pageGroups = new Map()
  let nextPage = 1
  for (const group of groups) {
    if (ids.has(group.id)) throw new Error(`Duplicate audit group ${group.id}`)
    ids.add(group.id)
    if (!STATUSES.has(group.status)) throw new Error(`Unknown status for ${group.id}`)
    if (group.first !== nextPage || group.last < group.first || group.last > 575) {
      throw new Error(`Gap, overlap or invalid page range at ${group.id}: expected page ${nextPage}`)
    }
    for (let page = group.first; page <= group.last; page++) pageGroups.set(page, group)
    nextPage = group.last + 1
  }
  if (nextPage !== 576) throw new Error(`Audit ends before page 575: next page ${nextPage}`)

  const lines = source.split(/\r?\n/)
  const rows = ['source_line,pdf_page,text_class,audit_group,group_status']
  const counts = { PAGE_MARKER: 0, BLANK: 0, BOILERPLATE: 0, REVIEWED_TEXT: 0 }
  let page = 0
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim()
    const marker = /^=== PAGE (\d+) ===$/.exec(text)
    let kind
    if (marker) {
      const found = Number(marker[1])
      if (found !== page + 1) throw new Error(`Missing/duplicate source page at line ${index + 1}`)
      page = found
      kind = 'PAGE_MARKER'
    } else if (!text) {
      kind = 'BLANK'
    } else if (/^(Course DV-09|Engineering Training Manual|EMERSON Process)/.test(text) ||
      /^\d+\s*-\s*\d+$/.test(text) || /^[\u2022\u2212\u2013]$/.test(text)) {
      kind = 'BOILERPLATE'
    } else {
      kind = 'REVIEWED_TEXT'
    }
    const group = pageGroups.get(page)
    if (!group) throw new Error(`Unmapped source line ${index + 1}, page ${page}`)
    counts[kind]++
    rows.push(`${index + 1},${page},${kind},${group.id},${group.status}`)
  }
  if (page !== 575) throw new Error(`Source ends at page ${page}, expected 575`)
  return { csv: rows.join('\n') + '\n', lines: lines.length, groups: groups.length, counts }
}

function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--write')) {
    throw new Error('Usage: node scripts\\validate-dv09-audit.mjs [--write]')
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const source = readFileSync(join(root, 'pdf_om.txt'))
  const actualHash = createHash('sha256').update(source).digest('hex')
  if (actualHash !== SOURCE_HASH) throw new Error('DV-09 extraction changed; review and update audit identity')
  const report = readFileSync(join(root, 'DV09-LINE-BY-LINE-AUDIT.txt'), 'utf8')
  if (!report.includes(SOURCE_HASH)) throw new Error('Audit report lacks the verified extraction hash')
  const result = buildAuditLedger(source.toString('utf8'), report)
  const target = join(root, 'DV09-LINE-DISPOSITIONS.csv')
  if (args[0] === '--write') writeFileSync(target, result.csv)
  else if (readFileSync(target, 'utf8') !== result.csv) {
    throw new Error('Line ledger is stale; review changes before regenerating with --write')
  }
  console.log(JSON.stringify({
    sourceHash: actualHash, pages: result.counts.PAGE_MARKER, sourceRecords: result.lines,
    groups: result.groups, classifications: result.counts, unmapped: 0,
    mode: args[0] === '--write' ? 'generated' : 'checked'
  }, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
