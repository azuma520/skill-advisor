#!/usr/bin/env node
/**
 * analyze-skills.mjs — Universal Skill Analysis Script
 *
 * Scans skill directories, extracts metadata from SKILL.md files,
 * analyzes quality metrics, detects cross-skill references and overlaps,
 * and outputs structured JSON for LLM advisory analysis.
 *
 * Usage:
 *   node analyze-skills.mjs [--json] [--dir <path>] [--moc <path>]
 *
 * Supports both flat layout (dir/skill-a/SKILL.md) and
 * grouped layout (dir/group/skill-a/SKILL.md).
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

// ── Constants ────────────────────────────────────────────────────
const SKILL_FILENAME = 'SKILL.md';

const KNOWN_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch',
  'Task', 'NotebookEdit', 'AskUserQuestion', 'Skill', 'ToolSearch',
];

const KNOWN_CLI_TOOLS = [
  'obsidian', 'obsidian-cli', 'qmd', 'defuddle', 'yt-dlp', 'whisper',
  'notebooklm', 'crawl4ai', 'gh', 'git', 'npm', 'bun', 'node',
  'python', 'python3', 'uv', 'ffmpeg', 'curl', 'jq',
];

// ── Arg Parsing ──────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const verbose = args.includes('--verbose');

function getArgValue(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return null;
}

const dirArg = getArgValue('--dir');
const mocArg = getArgValue('--moc');

// Resolve scan root: --dir arg, or ~/.claude/skills/
function resolveDir(d) {
  if (!d) return join(homedir(), '.claude', 'skills');
  if (d.startsWith('~')) return join(homedir(), d.slice(2));
  return resolve(d);
}
const SCAN_ROOT = resolveDir(dirArg);

// ── Helpers ──────────────────────────────────────────────────────
function listDir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function walkDir(dir) {
  const files = [];
  function walk(d, prefix) {
    for (const item of listDir(d)) {
      if (item === '.git' || item === 'node_modules') continue;
      const full = join(d, item);
      const rel = prefix ? `${prefix}/${item}` : item;
      if (isDir(full)) walk(full, rel);
      else files.push(rel);
    }
  }
  walk(dir, '');
  return files;
}

// ── Frontmatter Parser ───────────────────────────────────────────
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = {};
  const lines = match[1].split(/\r?\n/);
  let currentKey = null;
  let multilineValue = '';
  let quoteChar = null;

  function flush() {
    if (currentKey) {
      let val = multilineValue.trim();
      for (const q of ['"', "'"]) {
        if (val.startsWith(q) && val.endsWith(q) && val.length >= 2) {
          val = val.slice(1, -1);
          break;
        }
      }
      fm[currentKey] = val;
      currentKey = null;
      multilineValue = '';
      quoteChar = null;
    }
  }

  for (const line of lines) {
    if (quoteChar) {
      multilineValue += ' ' + line.trim();
      if (line.trimEnd().endsWith(quoteChar)) flush();
      continue;
    }

    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (kvMatch) {
      flush();
      const key = kvMatch[1];
      const val = kvMatch[2].trim();

      // Block scalar (>, |, >-, |-)
      if (/^[>|]-?$/.test(val)) {
        currentKey = key;
        multilineValue = '';
        continue;
      }

      // Opening quote without closing (multi-line quoted)
      for (const q of ['"', "'"]) {
        if (val.startsWith(q) && !val.endsWith(q)) {
          currentKey = key;
          multilineValue = val;
          quoteChar = q;
          break;
        }
      }
      if (quoteChar) continue;

      // Single-line value
      let cleaned = val;
      for (const q of ['"', "'"]) {
        if (cleaned.startsWith(q) && cleaned.endsWith(q) && cleaned.length >= 2) {
          cleaned = cleaned.slice(1, -1);
          break;
        }
      }
      fm[key] = cleaned;
    } else if (currentKey && line.trim()) {
      multilineValue += (multilineValue ? ' ' : '') + line.trim();
    }
  }
  flush();
  return fm;
}

// ── Scanner ──────────────────────────────────────────────────────
/**
 * Scan both flat (dir/skill/SKILL.md) and grouped (dir/group/skill/SKILL.md) layouts.
 * Returns array of skill objects.
 */
function scanSkillDirs(scanRoot) {
  const skills = [];
  const seen = new Set(); // avoid double-counting

  const topEntries = listDir(scanRoot).filter(d => {
    const full = join(scanRoot, d);
    return isDir(full) && !d.startsWith('.') && d !== 'node_modules';
  });

  for (const topName of topEntries) {
    const topPath = join(scanRoot, topName);

    // === Flat layout: dir/skill-a/SKILL.md ===
    const directSkillFile = join(topPath, SKILL_FILENAME);
    if (isFile(directSkillFile) && !seen.has(directSkillFile)) {
      seen.add(directSkillFile);
      skills.push(buildSkillEntry(topPath, topName, null, directSkillFile));
      continue;
    }

    // === Grouped layout: dir/group/skill-a/SKILL.md ===
    const subEntries = listDir(topPath).filter(d => {
      return isDir(join(topPath, d)) && !d.startsWith('.');
    });
    for (const subName of subEntries) {
      const subPath = join(topPath, subName);
      const groupedSkillFile = join(subPath, SKILL_FILENAME);
      if (isFile(groupedSkillFile) && !seen.has(groupedSkillFile)) {
        seen.add(groupedSkillFile);
        skills.push(buildSkillEntry(subPath, subName, topName, groupedSkillFile));
      }
    }
  }

  return skills;
}

function buildSkillEntry(skillPath, dirName, group, skillFile) {
  const content = readFileSync(skillFile, 'utf-8');
  const fm = parseFrontmatter(content);
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  const files = walkDir(skillPath);

  return {
    name: fm.name || dirName,
    dirName,
    group: group || null,
    path: skillPath,
    frontmatter: fm,
    description: fm.description || '',
    body,
    fullContent: content,
    files,
    hasRefs: isDir(join(skillPath, 'references')),
    hasEvals: isDir(join(skillPath, 'evals')),
    hasScripts: isDir(join(skillPath, 'scripts')),
  };
}

// ── Analysis Functions ───────────────────────────────────────────

function extractToolUsage(content) {
  const found = new Set();
  for (const tool of KNOWN_TOOLS) {
    const patterns = [
      new RegExp(`\\b${tool}\\b`, 'g'),
      new RegExp(`Use ${tool}`, 'gi'),
      new RegExp(`${tool} tool`, 'gi'),
    ];
    for (const p of patterns) {
      if (p.test(content)) { found.add(tool); break; }
    }
  }
  return [...found];
}

function extractCliDeps(content) {
  const found = new Set();
  const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
  const inlineCode = content.match(/`[^`]+`/g) || [];
  const allCode = [...codeBlocks, ...inlineCode].join(' ');

  for (const tool of KNOWN_CLI_TOOLS) {
    const patterns = [
      new RegExp(`\\b${tool}\\b`, 'g'),
      new RegExp(`${tool}\\.exe`, 'g'),
    ];
    for (const p of patterns) {
      if (p.test(allCode)) { found.add(tool); break; }
    }
  }
  return [...found];
}

function extractSkillRefs(content, allSkillNames, selfName) {
  const refs = new Set();
  for (const name of allSkillNames) {
    if (name !== selfName && content.includes(name)) {
      refs.add(name);
    }
  }
  return [...refs];
}

/**
 * Score trigger description quality 0-5.
 * Returns { score: number, issues: Array<{ tag, message }> }
 */
function checkTriggerQuality(description) {
  const issues = [];
  let score = 0;

  // 1. Has Chinese triggers?
  const hasChinese = /[\u4e00-\u9fff]/.test(description);
  if (hasChinese) score++;
  else issues.push({ tag: 'no-chinese', message: '無中文觸發詞' });

  // 2. Has English triggers?
  const hasEnglish = /[a-zA-Z]{3,}/.test(description);
  if (hasEnglish) score++;
  else issues.push({ tag: 'no-english', message: '無英文觸發詞' });

  // 3. Has pushy language (Use when / Make sure / even if)?
  const isPushy = /Use when|Make sure|even if|Trigger|使用此|即使/i.test(description);
  if (isPushy) score++;
  else issues.push({ tag: 'not-pushy', message: 'Description 不夠 pushy（缺乏 Use when/Make sure 語句）' });

  // 4. Reasonable length (50–500 chars)?
  if (description.length >= 50 && description.length <= 500) score++;
  else if (description.length < 50) issues.push({ tag: 'too-short', message: `Description 太短（${description.length} 字）` });
  else issues.push({ tag: 'too-long', message: `Description 過長（${description.length} 字，建議 <500）` });

  // 5. Has disambiguation (NOT for)?
  const hasNegative = /NOT for|不適用|use .+ instead|而非/i.test(description);
  if (hasNegative) score++;
  // No issue tag if missing — it's a bonus

  return { score, issues };
}

// ── MOC Generator ────────────────────────────────────────────────
function generateMoc(skills, referenceGraph, mocPath) {
  const lines = [];
  lines.push('# Skill Map (MOC)');
  lines.push('');
  lines.push(`> Generated: ${new Date().toISOString().split('T')[0]}`);
  lines.push(`> Total skills: ${skills.length}`);
  lines.push('');
  lines.push('## Cross-Skill Dependencies');
  lines.push('');

  const hasAnyRefs = skills.some(s => s.skillRefs && s.skillRefs.length > 0);
  if (!hasAnyRefs) {
    lines.push('_No cross-skill references detected._');
  } else {
    for (const skill of skills) {
      if (!skill.skillRefs || skill.skillRefs.length === 0) continue;
      const wikiSelf = `[[${skill.dirName}/SKILL|${skill.name}]]`;
      const wikiRefs = skill.skillRefs.map(ref => {
        const target = skills.find(s => s.name === ref || s.dirName === ref);
        if (target) return `[[${target.dirName}/SKILL|${target.name}]]`;
        return `[[${ref}/SKILL|${ref}]]`;
      });
      lines.push(`- ${wikiSelf} → ${wikiRefs.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('## All Skills');
  lines.push('');

  // Group by group if any
  const grouped = {};
  for (const skill of skills) {
    const g = skill.group || '(flat)';
    if (!grouped[g]) grouped[g] = [];
    grouped[g].push(skill);
  }

  for (const [g, skillList] of Object.entries(grouped).sort()) {
    if (g !== '(flat)') lines.push(`### ${g}`);
    for (const skill of skillList) {
      const wikiLink = `[[${skill.dirName}/SKILL|${skill.name}]]`;
      const orphanTag = skill.isOrphan ? ' _(orphan)_' : '';
      lines.push(`- ${wikiLink}${orphanTag}`);
    }
    lines.push('');
  }

  const mocContent = lines.join('\n');

  // Ensure parent directory exists
  const parentDir = dirname(resolve(mocPath));
  try { mkdirSync(parentDir, { recursive: true }); } catch {}

  writeFileSync(mocPath, mocContent, 'utf-8');
  if (!jsonMode) console.log(`MOC written to: ${mocPath}`);
}

// ── Main ─────────────────────────────────────────────────────────
function main() {
  if (!isDir(SCAN_ROOT)) {
    console.error(`Error: scan root does not exist: ${SCAN_ROOT}`);
    process.exit(1);
  }

  const skills = scanSkillDirs(SCAN_ROOT);

  if (skills.length === 0) {
    if (!jsonMode) console.log('No SKILL.md files found in', SCAN_ROOT);
    else console.log(JSON.stringify({ generatedAt: new Date().toISOString(), scanRoot: SCAN_ROOT, summary: {}, skills: [], referenceGraph: {} }, null, 2));
    return;
  }

  // All identifiers for cross-ref detection: both name and dirName
  const allIdentifiers = skills.flatMap(s => [s.name, s.dirName].filter(Boolean));

  // Enrich skills
  for (const skill of skills) {
    skill.tools = extractToolUsage(skill.fullContent);
    skill.cliDeps = extractCliDeps(skill.fullContent);
    // Refs by both name and dirName
    const selfIds = [skill.name, skill.dirName].filter(Boolean);
    const refsRaw = new Set();
    for (const id of allIdentifiers) {
      if (!selfIds.includes(id) && skill.fullContent.includes(id)) {
        refsRaw.add(id);
      }
    }
    // Normalize refs to skill names
    skill.skillRefs = [...refsRaw].map(ref => {
      const found = skills.find(s => s.name === ref || s.dirName === ref);
      return found ? found.name : ref;
    }).filter((v, i, arr) => arr.indexOf(v) === i); // dedupe

    skill.triggerQuality = checkTriggerQuality(skill.description);
  }

  // Build reference graph: name -> { referencedBy, references }
  const referencedBy = {};
  for (const skill of skills) {
    for (const ref of skill.skillRefs) {
      if (!referencedBy[ref]) referencedBy[ref] = [];
      if (!referencedBy[ref].includes(skill.name)) referencedBy[ref].push(skill.name);
    }
  }

  // Mark orphans
  for (const skill of skills) {
    const inbound = referencedBy[skill.name] || [];
    skill.isOrphan = skill.skillRefs.length === 0 && inbound.length === 0;
  }

  // Build reference graph output
  const referenceGraph = {};
  for (const skill of skills) {
    referenceGraph[skill.name] = {
      references: skill.skillRefs,
      referencedBy: referencedBy[skill.name] || [],
    };
  }

  // Summary stats
  const orphans = skills.filter(s => s.isOrphan);
  const avgTriggerScore = skills.length
    ? Math.round((skills.reduce((sum, s) => sum + s.triggerQuality.score, 0) / skills.length) * 10) / 10
    : 0;
  const totalDescriptionChars = skills.reduce((sum, s) => sum + s.description.length, 0);
  const evalCoverage = skills.length
    ? Math.round((skills.filter(s => s.hasEvals).length / skills.length) * 100)
    : 0;
  const refCoverage = skills.length
    ? Math.round((skills.filter(s => s.hasRefs).length / skills.length) * 100)
    : 0;
  const orphanRate = skills.length
    ? Math.round((orphans.length / skills.length) * 100)
    : 0;

  const summary = {
    totalSkills: skills.length,
    orphanRate: `${orphanRate}%`,
    avgTriggerScore,
    totalDescriptionChars,
    evalCoverage: `${evalCoverage}%`,
    totalTokenEstimate: skills.reduce((sum, s) => sum + Math.ceil(s.description.length / 2), 0),
    refCoverage: `${refCoverage}%`,
  };

  // Build output skill records
  const skillsOutput = skills.map(s => ({
    name: s.name,
    dirName: s.dirName,
    group: s.group,
    description: s.description,
    descriptionTokenEstimate: Math.ceil(s.description.length / 2),
    triggerQuality: s.triggerQuality,
    tools: s.tools,
    cliDeps: s.cliDeps,
    skillRefs: s.skillRefs,
    referencedBy: referencedBy[s.name] || [],
    isOrphan: s.isOrphan,
    hasRefs: s.hasRefs,
    hasEvals: s.hasEvals,
    hasScripts: s.hasScripts,
    fileCount: s.files.length,
    files: s.files,
  }));

  const output = {
    generatedAt: new Date().toISOString(),
    scanRoot: SCAN_ROOT,
    summary,
    skills: skillsOutput,
    referenceGraph,
  };

  // MOC generation (always, regardless of --json flag)
  if (mocArg) {
    generateMoc(skills, referenceGraph, mocArg);
  }

  if (jsonMode) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Human-readable report
    console.log('# Skill Health Report\n');
    console.log(`Scan root: ${SCAN_ROOT}`);
    console.log(`Generated: ${new Date().toLocaleString()}\n`);
    console.log('## Summary');
    for (const [k, v] of Object.entries(summary)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log('\n## Skills');
    for (const s of skillsOutput) {
      const orphanFlag = s.isOrphan ? ' [ORPHAN]' : '';
      console.log(`\n### ${s.name}${orphanFlag}`);
      console.log(`  Group: ${s.group || '(none)'}`);
      console.log(`  Trigger score: ${s.triggerQuality.score}/5`);
      if (s.triggerQuality.issues.length) {
        for (const issue of s.triggerQuality.issues) {
          console.log(`    ⚠ [${issue.tag}] ${issue.message}`);
        }
      }
      if (s.skillRefs.length) console.log(`  References: ${s.skillRefs.join(', ')}`);
      if (s.referencedBy.length) console.log(`  Referenced by: ${s.referencedBy.join(', ')}`);
      if (s.tools.length) console.log(`  Tools: ${s.tools.join(', ')}`);
      if (s.cliDeps.length) console.log(`  CLI deps: ${s.cliDeps.join(', ')}`);
    }
  }
}

main();
