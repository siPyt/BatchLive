const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'pdf_om.txt'), 'utf8')
const report = fs.readFileSync(path.join(root, 'DV09-LINE-BY-LINE-AUDIT.txt'), 'utf8')
const validator = import('../scripts/validate-dv09-audit.mjs')

test('DV09 ledger maps every record exactly once through the trailing blank and page 575', async () => {
  const { buildAuditLedger } = await validator
  const result = buildAuditLedger(source, report)
  assert.equal(result.lines, 12157)
  assert.equal(result.groups, 128)
  assert.equal(result.counts.PAGE_MARKER, 575)
  assert.equal(Object.values(result.counts).reduce((a, b) => a + b, 0), result.lines)
  assert.equal(result.csv, fs.readFileSync(path.join(root, 'DV09-LINE-DISPOSITIONS.csv'), 'utf8'))
  const rows = result.csv.trimEnd().split('\n').slice(1)
  rows.forEach((row, index) => assert.equal(Number(row.split(',')[0]), index + 1))
  assert.equal(rows.at(-1), '12157,575,BLANK,DV09-128,CONTEXT')
  assert.equal(buildAuditLedger(source.replace(/\r?\n/g, '\r\n'),
    report.replace(/\r?\n/g, '\r\n')).csv, result.csv)
})

test('DV09 validator rejects missing, overlapping and incomplete page review', async () => {
  const { buildAuditLedger } = await validator
  for (const replacement of ['6-36', '4-36', '5-4']) {
    assert.throws(() => buildAuditLedger(source, report.replace('Pages: 5-36', `Pages: ${replacement}`)),
      /Gap, overlap or invalid page range/)
  }
  assert.throws(() => buildAuditLedger(source, report.replace('Pages: 574-575', 'Pages: 574-574')),
    /ends before page 575/)
})

test('DV09 validator rejects duplicate groups, malformed fields and unknown status', async () => {
  const { buildAuditLedger } = await validator
  assert.throws(() => buildAuditLedger(source, report.replace('[DV09-002]', '[DV09-001]')),
    /Duplicate audit group/)
  assert.throws(() => buildAuditLedger(source, report.replace('Pages: 5-36', 'Pages: unreviewed')),
    /Every audit group/)
  assert.throws(() => buildAuditLedger(source, report.replace('Status: BOUNDARY', 'Status: COMPLETE')),
    /Unknown status/)
})

test('DV09 validator rejects missing, duplicate or out-of-order extraction pages', async () => {
  const { buildAuditLedger } = await validator
  assert.throws(() => buildAuditLedger(source.replace('=== PAGE 2 ===', '=== PAGE 1 ==='), report),
    /Missing\/duplicate source page/)
  assert.throws(() => buildAuditLedger(source.replace('=== PAGE 2 ===', ''), report),
    /Missing\/duplicate source page/)
  assert.throws(() => buildAuditLedger(source.slice(0, source.indexOf('=== PAGE 575 ===')), report),
    /Source ends at page 574/)
})

test('DV09 mapping copies no source text and does not classify content by feature keywords', async () => {
  const { buildAuditLedger } = await validator
  const result = buildAuditLedger(source.replace('Duplication Prohibited', 'download motor signature unsupported'), report)
  assert.ok(!result.csv.includes('download motor'))
  assert.equal(result.csv, buildAuditLedger(source, report).csv)
})

test('DV09 dated remaining-work index lists every non-context group exactly once and separates external boundaries', () => {
  const groups = [...report.matchAll(/^\[(DV09-\d+)\]\r?\nPages:.*\r?\nStatus: (\w+)/gm)]
  const expected = groups.filter(([, , status]) => status !== 'CONTEXT').map(([, id]) => id).sort()
  const index = report.split('EXACT KNOWN REMAINING-WORK INDEX (AFTER PASS53)')[1]
  assert.ok(index, 'remaining-work index must exist')
  const listed = [...index.matchAll(/^(DV09-\d+):/gm)].map(([, id]) => id)
  assert.equal(new Set(listed).size, listed.length, 'no duplicate remaining groups')
  assert.deepEqual([...listed].sort(), expected, 'no omitted or invented remaining groups')
  const external = index.split('G. EXTERNAL/PHYSICAL BOUNDARIES')[1].split('H. FINAL ACCEPTANCE')[0]
  const boundaryIds = [...external.matchAll(/^(DV09-\d+):/gm)].map(([, id]) => id).sort()
  assert.deepEqual(boundaryIds, groups.filter(([, , status]) => status === 'BOUNDARY').map(([, id]) => id).sort())
  const history = report.split('DATED CHANGE HISTORY - WHAT CHANGED AND WHEN')[1].split('CURRENT TASK CHANGE DETAIL')[0]
  const entries = [...history.matchAll(/^(\d{2}:\d{2}:\d{2}) ([a-f0-9]{7}) (\S.*)$/gm)]
  assert.equal(entries.length, 93, 'frozen implementation history through Pass53 includes all 93 commits')
  assert.equal(new Set(entries.map(([, , sha]) => sha)).size, entries.length)
  assert.match(history, /21:17:58 0dc6c8f /)
  assert.match(report, /2026-10-04T21:17:58-05:00/)
})
