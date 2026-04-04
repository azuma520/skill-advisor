#!/usr/bin/env node
/**
 * test-analyze.mjs — Integration tests for analyze-skills.mjs
 *
 * Creates 3 temporary fake skills, runs analyze-skills.mjs --json,
 * asserts correctness, and cleans up.
 */

import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __file = fileURLToPath(import.meta.url);
const __dir = dirname(__file);
const SCRIPT = join(__dir, 'analyze-skills.mjs');

// ── Test helpers ─────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

function assertDeep(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, label);
  if (!ok) {
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
  }
}

// ── Setup temp skills ────────────────────────────────────────────
const tempDir = mkdtempSync(join(tmpdir(), 'skill-test-'));

function makeSkill(name, content, subdir = null) {
  const skillDir = subdir
    ? join(tempDir, subdir, name)
    : join(tempDir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
  return skillDir;
}

// skill-a: references skill-b, has tools + CLI deps, no evals
const skillAContent = `---
name: skill-a
description: >
  Use when you want to run bash scripts or read files.
  Make sure to use Bash and Read tools. NOT for writing tasks.
  Also see skill-b for knowledge management. Uses node and python.
---

# skill-a

References skill-b for upstream processing.

Use \`node script.js\` and \`python3 tool.py\` to run.

Use the Bash tool and Read tool here.
`;

// skill-b: has evals + references dir, references nobody (but is referenced by skill-a), has eval folder
const skillBContent = `---
name: skill-b
description: >
  Use when you need knowledge management and qmd search.
  Make sure to trigger this skill when user mentions notes or vault.
  NOT for file editing (use skill-a instead).
---

# skill-b

Standalone knowledge skill. Uses \`qmd\` and \`git\` for indexing.

Uses the Grep tool and Write tool.
`;

// skill-c: orphan, short description, no refs in or out
const skillCContent = `---
name: skill-c
description: Short.
---

# skill-c

Completely standalone. No references anywhere.
`;

// Flat layout skills
makeSkill('skill-a', skillAContent);
const skillBDir = makeSkill('skill-b', skillBContent);
mkdirSync(join(skillBDir, 'evals'), { recursive: true });
writeFileSync(join(skillBDir, 'evals', 'test-1.md'), '# eval', 'utf-8');
mkdirSync(join(skillBDir, 'references'), { recursive: true });
makeSkill('skill-c', skillCContent);

// Grouped layout: group-x/skill-d/SKILL.md
const skillDContent = `---
name: skill-d
description: >
  Use when working with grouped skill structures. Even if the layout is nested,
  Make sure this skill triggers. NOT for flat skills. References skill-a for base ops.
---

# skill-d (grouped)

This skill is in a group. Uses \`git\` and the Bash tool.
`;
makeSkill('skill-d', skillDContent, 'group-x');

// ── Run analyze-skills.mjs ───────────────────────────────────────
console.log(`\nRunning analyze-skills.mjs against: ${tempDir}\n`);

let output;
let data;
try {
  output = execSync(`node "${SCRIPT}" --json --dir "${tempDir}"`, { encoding: 'utf-8' });
  data = JSON.parse(output);
} catch (err) {
  console.error('FATAL: Script failed or output is not valid JSON');
  console.error(err.message);
  if (err.stdout) console.error('stdout:', err.stdout.slice(0, 500));
  if (err.stderr) console.error('stderr:', err.stderr.slice(0, 500));
  process.exit(1);
}

// ── Assertions ───────────────────────────────────────────────────
console.log('## Basic structure');
assert(typeof data === 'object' && data !== null, 'output is valid JSON object');
assert(typeof data.generatedAt === 'string', 'has generatedAt');
assert(typeof data.scanRoot === 'string', 'has scanRoot');
assert(typeof data.summary === 'object', 'has summary');
assert(Array.isArray(data.skills), 'has skills array');
assert(Array.isArray(data.overlaps), 'has overlaps array');
assert(typeof data.referenceGraph === 'object', 'has referenceGraph');

console.log('\n## Skill names detected');
const skillNames = data.skills.map(s => s.name);
assert(skillNames.includes('skill-a'), 'skill-a detected');
assert(skillNames.includes('skill-b'), 'skill-b detected');
assert(skillNames.includes('skill-c'), 'skill-c detected');
assert(skillNames.includes('skill-d'), 'skill-d detected (grouped)');
assert(data.skills.length === 4, `exactly 4 skills found (got ${data.skills.length})`);

console.log('\n## Grouped layout');
const skillD = data.skills.find(s => s.name === 'skill-d');
assert(skillD !== undefined, 'skill-d found');
assert(skillD.group === 'group-x', `skill-d has group=group-x (got ${skillD?.group})`);

console.log('\n## Cross-skill references');
const skillA = data.skills.find(s => s.name === 'skill-a');
assert(skillA !== undefined, 'skill-a found');
assert(Array.isArray(skillA.skillRefs), 'skill-a has skillRefs array');
assert(skillA.skillRefs.includes('skill-b'), `skill-a references skill-b (got: ${JSON.stringify(skillA?.skillRefs)})`);

console.log('\n## Orphan detection');
const skillC = data.skills.find(s => s.name === 'skill-c');
assert(skillC !== undefined, 'skill-c found');
assert(skillC.isOrphan === true, `skill-c is orphan (got isOrphan=${skillC?.isOrphan})`);
assert(skillA.isOrphan === false, `skill-a is NOT orphan (references skill-b)`);

console.log('\n## Trigger quality issues have tag + message');
const skillCTrigger = skillC.triggerQuality;
assert(typeof skillCTrigger === 'object', 'skill-c has triggerQuality');
assert(Array.isArray(skillCTrigger.issues), 'triggerQuality.issues is array');
assert(skillCTrigger.issues.length > 0, 'skill-c has trigger issues');
const firstIssue = skillCTrigger.issues[0];
assert(typeof firstIssue.tag === 'string', `first issue has tag (got: ${JSON.stringify(firstIssue)})`);
assert(typeof firstIssue.message === 'string', 'first issue has message');
// too-short should be present for "Short."
const hasTooShort = skillCTrigger.issues.some(i => i.tag === 'too-short');
assert(hasTooShort, `skill-c has too-short issue (issues: ${JSON.stringify(skillCTrigger.issues.map(i=>i.tag))})`);

console.log('\n## Evals and refs presence');
const skillB = data.skills.find(s => s.name === 'skill-b');
assert(skillB !== undefined, 'skill-b found');
assert(skillB.hasEvals === true, `skill-b hasEvals=true (got ${skillB?.hasEvals})`);
assert(skillB.hasRefs === true, `skill-b hasRefs=true (got ${skillB?.hasRefs})`);
assert(skillA.hasEvals === false, 'skill-a hasEvals=false');

console.log('\n## CLI deps detected');
assert(Array.isArray(skillA.cliDeps), 'skill-a has cliDeps');
assert(skillA.cliDeps.includes('node'), `skill-a detects node CLI dep (got: ${JSON.stringify(skillA?.cliDeps)})`);
assert(skillA.cliDeps.includes('python3'), `skill-a detects python3 CLI dep`);
assert(skillB.cliDeps.includes('qmd'), `skill-b detects qmd CLI dep (got: ${JSON.stringify(skillB?.cliDeps)})`);
assert(skillB.cliDeps.includes('git'), `skill-b detects git CLI dep`);

console.log('\n## Tool usage detected');
assert(Array.isArray(skillA.tools), 'skill-a has tools array');
assert(skillA.tools.includes('Bash'), `skill-a detects Bash tool (got: ${JSON.stringify(skillA?.tools)})`);
assert(skillA.tools.includes('Read'), `skill-a detects Read tool`);
assert(skillB.tools.includes('Grep'), `skill-b detects Grep tool (got: ${JSON.stringify(skillB?.tools)})`);
assert(skillB.tools.includes('Write'), `skill-b detects Write tool`);

console.log('\n## Summary stats');
const s = data.summary;
assert(typeof s.totalSkills === 'number', 'summary.totalSkills is number');
assert(s.totalSkills === 4, `summary.totalSkills=4 (got ${s.totalSkills})`);
assert(typeof s.orphanRate === 'string', 'summary.orphanRate is string');
assert(typeof s.avgTriggerScore === 'number', 'summary.avgTriggerScore is number');
assert(typeof s.totalDescriptionChars === 'number', 'summary.totalDescriptionChars is number');
assert(typeof s.evalCoverage === 'string', 'summary.evalCoverage is string');
assert(typeof s.overlapPairCount === 'number', 'summary.overlapPairCount is number');
assert(typeof s.refCoverage === 'string', 'summary.refCoverage is string');

console.log('\n## Overlaps array');
assert(Array.isArray(data.overlaps), 'overlaps is array');
// We expect skill-a and skill-d might overlap since both mention "skill" "bash" etc
// Just check it's valid
if (data.overlaps.length > 0) {
  const o = data.overlaps[0];
  assert(Array.isArray(o.skills) && o.skills.length === 2, 'overlap entry has skills[2]');
  assert(Array.isArray(o.commonKeywords), 'overlap entry has commonKeywords');
  assert(typeof o.overlapRatio === 'string', 'overlap entry has overlapRatio string');
}

console.log('\n## Reference graph');
assert(typeof data.referenceGraph['skill-a'] === 'object', 'referenceGraph has skill-a');
assert(Array.isArray(data.referenceGraph['skill-a'].references), 'skill-a refs is array');
assert(data.referenceGraph['skill-a'].references.includes('skill-b'), 'skill-a→skill-b in graph');
assert(Array.isArray(data.referenceGraph['skill-b'].referencedBy), 'skill-b.referencedBy is array');
assert(data.referenceGraph['skill-b'].referencedBy.includes('skill-a'), 'skill-b referencedBy skill-a');

// ── Test MOC generation ──────────────────────────────────────────
console.log('\n## MOC generation');
const mocPath = join(tempDir, 'skill-map.md');
try {
  execSync(`node "${SCRIPT}" --json --dir "${tempDir}" --moc "${mocPath}"`, { encoding: 'utf-8' });
  assert(existsSync(mocPath), 'MOC file created');
  if (existsSync(mocPath)) {
    const { readFileSync } = await import('fs');
    const mocContent = readFileSync(mocPath, 'utf-8');
    assert(mocContent.includes('[[skill-a/SKILL'), 'MOC contains skill-a wikilink');
    assert(mocContent.includes('[[skill-b/SKILL'), 'MOC contains skill-b wikilink');
    assert(mocContent.includes('(orphan)'), `MOC marks orphan skills (checking for orphan tag)`);
  }
} catch (err) {
  console.error('MOC test failed:', err.message);
  failed++;
}

// ── Cleanup ──────────────────────────────────────────────────────
try {
  rmSync(tempDir, { recursive: true, force: true });
  console.log(`\nCleaned up temp dir: ${tempDir}`);
} catch (err) {
  console.warn(`Warning: could not clean up ${tempDir}: ${err.message}`);
}

// ── Results ──────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('TESTS FAILED');
  process.exit(1);
} else {
  console.log('ALL TESTS PASSED');
}
