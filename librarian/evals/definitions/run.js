#!/usr/bin/env node

// Definition Eval Runner
// Usage: node run.js [--model gpt-4o] [--judge-model gpt-4o-mini] [--cases grave-adjective,vexed-archaic] [--no-judge] [--verbose]
//
// Requires OPENAI_API_KEY environment variable (or pass --api-key)

import { readFileSync } from 'fs';
import { gradeStructure, gradeAccuracy } from './graders.js';
import { judgeContextQuality } from './llm-judge.js';

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const hasFlag = (name) => args.includes(`--${name}`);

const MODEL = getArg('model', 'gpt-4o');
const JUDGE_MODEL = getArg('judge-model', 'gpt-4o-mini');
const API_KEY = getArg('api-key', process.env.OPENAI_API_KEY);
const CASE_FILTER = getArg('cases', null); // comma-separated IDs
const SKIP_JUDGE = hasFlag('no-judge');
const VERBOSE = hasFlag('verbose');

if (!API_KEY) {
  console.error('Error: OPENAI_API_KEY not set. Pass --api-key or export OPENAI_API_KEY.');
  process.exit(1);
}

// ── Load test cases ──────────────────────────────────────────────────────────

const allCases = JSON.parse(readFileSync(new URL('./test-cases.json', import.meta.url), 'utf-8'));
const filterSet = CASE_FILTER ? new Set(CASE_FILTER.split(',').map(s => s.trim())) : null;
const testCases = filterSet ? allCases.filter(tc => filterSet.has(tc.id)) : allCases;

console.log(`\n📖 Definition Eval`);
console.log(`   Model: ${MODEL} | Judge: ${SKIP_JUDGE ? 'disabled' : JUDGE_MODEL}`);
console.log(`   Cases: ${testCases.length}/${allCases.length}\n`);

// ── Call OpenAI (same prompt as the app) ─────────────────────────────────────

const SYSTEM_PROMPT = `You are a vocabulary assistant for someone reading English literature.
Given a word and the paragraph it appears in, provide:
1. The word's pronunciation (IPA)
2. Its part of speech
3. A clear, simple dictionary definition (2-3 sentences max)
4. What it specifically means in this context — reference the characters, scene, or theme (2-3 sentences max)

Keep language simple and direct. The reader is fluent in English but building literary vocabulary. Don't be academic — be helpful like a well-read friend explaining a word.

Respond in JSON only, no markdown:
{
  "pronunciation": "string (IPA)",
  "part_of_speech": "string",
  "definition": "string",
  "context_meaning": "string"
}`;

async function fetchDefinition(testCase) {
  const userMessage = `Word: "${testCase.word}"
Paragraph: "${testCase.paragraph}"
Book: "${testCase.bookTitle}"${testCase.bookAuthor ? ` by ${testCase.bookAuthor}` : ''}
Chapter: ${testCase.chapterTitle}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  const tokens = data.usage ? data.usage.prompt_tokens + data.usage.completion_tokens : 0;

  // Parse JSON (same logic as the app)
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error(`Unparseable response: ${content.slice(0, 200)}`);
  }

  return { parsed, tokens };
}

// ── Run all cases ────────────────────────────────────────────────────────────

const results = [];
let totalTokens = 0;

for (let i = 0; i < testCases.length; i++) {
  const tc = testCases[i];
  const label = `[${i + 1}/${testCases.length}] ${tc.id}`;
  process.stdout.write(`  ${label} ...`);

  const caseResult = {
    id: tc.id,
    category: tc.category,
    word: tc.word,
    response: null,
    grades: {},
    error: null,
  };

  try {
    // 1. Fetch definition from AI
    const { parsed, tokens } = await fetchDefinition(tc);
    caseResult.response = parsed;
    totalTokens += tokens;

    // 2. Grade: structure
    caseResult.grades.structure = gradeStructure(parsed);

    // 3. Grade: accuracy
    caseResult.grades.accuracy = gradeAccuracy(parsed, tc);

    // 4. Grade: LLM judge (context quality)
    if (!SKIP_JUDGE && parsed.context_meaning) {
      const judgeResult = await judgeContextQuality({
        word: tc.word,
        paragraph: tc.paragraph,
        contextMeaning: parsed.context_meaning,
        apiKey: API_KEY,
        model: JUDGE_MODEL,
      });
      caseResult.grades.llm_judge = judgeResult;
      totalTokens += judgeResult.tokens || 0;
    }

    // Print inline result
    const allPassed = Object.values(caseResult.grades).every(g => g.passed === g.total);
    process.stdout.write(allPassed ? ' ✅\n' : ' ❌\n');

    // Print failures in verbose mode
    if (VERBOSE && !allPassed) {
      for (const [graderName, grade] of Object.entries(caseResult.grades)) {
        for (const check of grade.checks) {
          if (!check.pass) {
            console.log(`    ⚠ ${graderName}.${check.name}: ${check.detail}`);
          }
        }
      }
    }

  } catch (err) {
    caseResult.error = err.message;
    process.stdout.write(` 💥 ${err.message}\n`);
  }

  results.push(caseResult);
}

// ── Scorecard ────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(65));
console.log('  SCORECARD');
console.log('═'.repeat(65));

// Aggregate by grader
const graderTotals = {};

for (const r of results) {
  if (r.error) continue;
  for (const [graderName, grade] of Object.entries(r.grades)) {
    if (!graderTotals[graderName]) {
      graderTotals[graderName] = { passed: 0, total: 0, checkTotals: {} };
    }
    graderTotals[graderName].passed += grade.passed;
    graderTotals[graderName].total += grade.total;

    // Per-check breakdown
    for (const check of grade.checks) {
      if (!graderTotals[graderName].checkTotals[check.name]) {
        graderTotals[graderName].checkTotals[check.name] = { passed: 0, total: 0 };
      }
      graderTotals[graderName].checkTotals[check.name].total++;
      if (check.pass) graderTotals[graderName].checkTotals[check.name].passed++;
    }
  }
}

for (const [graderName, totals] of Object.entries(graderTotals)) {
  const pct = totals.total > 0 ? ((totals.passed / totals.total) * 100).toFixed(1) : '0.0';
  console.log(`\n  ${graderName.toUpperCase()}: ${totals.passed}/${totals.total} (${pct}%)`);
  console.log('  ' + '─'.repeat(50));
  for (const [checkName, ct] of Object.entries(totals.checkTotals)) {
    const cpct = ct.total > 0 ? ((ct.passed / ct.total) * 100).toFixed(0) : '0';
    const bar = ct.passed === ct.total ? '✅' : '⚠️';
    console.log(`    ${bar} ${checkName}: ${ct.passed}/${ct.total} (${cpct}%)`);
  }
}

// Aggregate by category
const categoryResults = {};
for (const r of results) {
  const cat = r.category || 'unknown';
  if (!categoryResults[cat]) categoryResults[cat] = { passed: 0, total: 0 };
  if (r.error) {
    categoryResults[cat].total++;
    continue;
  }
  const allPassed = Object.values(r.grades).every(g => g.passed === g.total);
  categoryResults[cat].total++;
  if (allPassed) categoryResults[cat].passed++;
}

console.log(`\n  BY CATEGORY:`);
console.log('  ' + '─'.repeat(50));
for (const [cat, ct] of Object.entries(categoryResults)) {
  const pct = ct.total > 0 ? ((ct.passed / ct.total) * 100).toFixed(0) : '0';
  console.log(`    ${cat}: ${ct.passed}/${ct.total} (${pct}% fully passing)`);
}

// Errors
const errors = results.filter(r => r.error);
if (errors.length > 0) {
  console.log(`\n  ❗ ERRORS: ${errors.length} cases failed to run`);
  for (const r of errors) {
    console.log(`    - ${r.id}: ${r.error}`);
  }
}

// Failed cases summary
const failed = results.filter(r => !r.error && !Object.values(r.grades).every(g => g.passed === g.total));
if (failed.length > 0) {
  console.log(`\n  ❌ FAILED CASES (${failed.length}):`);
  for (const r of failed) {
    const failedChecks = [];
    for (const [graderName, grade] of Object.entries(r.grades)) {
      for (const check of grade.checks) {
        if (!check.pass) failedChecks.push(`${graderName}.${check.name}`);
      }
    }
    console.log(`    - ${r.id} (${r.word}): ${failedChecks.join(', ')}`);
  }
}

// Overall
const totalPassed = Object.values(graderTotals).reduce((s, g) => s + g.passed, 0);
const totalChecks = Object.values(graderTotals).reduce((s, g) => s + g.total, 0);
const overallPct = totalChecks > 0 ? ((totalPassed / totalChecks) * 100).toFixed(1) : '0.0';

console.log('\n' + '═'.repeat(65));
console.log(`  OVERALL: ${totalPassed}/${totalChecks} checks passed (${overallPct}%)`);
console.log(`  TOKENS:  ~${totalTokens.toLocaleString()} total`);
console.log('═'.repeat(65) + '\n');

// Exit with error code if any failures
process.exit(failed.length > 0 || errors.length > 0 ? 1 : 0);
