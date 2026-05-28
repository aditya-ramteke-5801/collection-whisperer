// Code-based graders for definition eval
// These check structure, types, and factual accuracy without needing an LLM

const VALID_POS = new Set([
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
  'conjunction', 'interjection', 'determiner', 'article',
  // compound forms the AI might return
  'phrasal verb', 'auxiliary verb', 'modal verb',
  'proper noun', 'common noun', 'transitive verb', 'intransitive verb',
  'past participle', 'present participle',
]);

// Extract the stem of a word by stripping common suffixes.
// Not a full stemmer — just enough to catch behave/behavior, oppose/opposition, etc.
function stem(word) {
  return word.toLowerCase()
    .replace(/(tion|sion|ment|ness|ity|ous|ive|ing|ful|less|able|ible|ly|ed|er|est|al|ence|ance|ism|ist|ent|ant|ure|ary|ory)$/, '')
    .replace(/(at|is|iz)$/, '') // normalize: opposition -> oppos -> oppos, oppose -> oppos
    .replace(/(.)\1$/, '$1');   // collapse double letters: fawnn -> fawn
}

// Check if two words share the same stem
function stemMatch(a, b) {
  const sa = stem(a);
  const sb = stem(b);
  // At least 3 chars in common stem to avoid false positives
  if (sa.length < 3 || sb.length < 3) return false;
  return sa === sb || sa.startsWith(sb) || sb.startsWith(sa);
}

// Check if a keyword matches anywhere in the text, using both exact substring and stem matching
function keywordFound(keyword, text) {
  const textLower = text.toLowerCase();
  const kwLower = keyword.toLowerCase();
  // Exact substring match
  if (textLower.includes(kwLower)) return true;
  // Stem match against individual words in text
  const textWords = textLower.split(/\W+/).filter(w => w.length > 0);
  return textWords.some(tw => stemMatch(tw, kwLower));
}

// Rough check: does the string look like IPA?
// IPA uses /slashes/ or [brackets] and contains phonetic characters
function looksLikeIPA(str) {
  if (!str || typeof str !== 'string') return false;
  // Has IPA delimiters
  const hasDelimiters = /^[/\[].*[/\]]$/.test(str.trim());
  // Contains common IPA characters
  const hasIPAChars = /[əɪʊæɑɒʌɛɔːˈˌŋθðʃʒɹɾ]/.test(str);
  return hasDelimiters || hasIPAChars;
}

// Normalize a POS string for comparison
function normalizePOS(pos) {
  if (!pos) return '';
  return pos.toLowerCase().trim()
    .replace(/^(past |present )?participle.*/, 'verb')  // past participle -> verb
    .replace(/^(transitive |intransitive |auxiliary |modal |phrasal )/, '') // strip qualifiers
    .replace(/^proper noun$/, 'noun')
    .replace(/^common noun$/, 'noun');
}

/**
 * Layer 1: Structure check
 * Does the response have valid JSON shape with all required fields?
 */
export function gradeStructure(response) {
  const results = {
    name: 'structure',
    checks: [],
    passed: 0,
    total: 0,
  };

  function check(name, pass, detail) {
    results.checks.push({ name, pass, detail });
    results.total++;
    if (pass) results.passed++;
  }

  // Is it an object?
  check(
    'is_object',
    response !== null && typeof response === 'object' && !Array.isArray(response),
    typeof response
  );

  if (typeof response !== 'object' || response === null) {
    return results; // can't check further
  }

  // Has all 4 required fields?
  const required = ['pronunciation', 'part_of_speech', 'definition', 'context_meaning'];
  for (const field of required) {
    check(
      `has_${field}`,
      field in response,
      field in response ? 'present' : 'missing'
    );
  }

  // All fields are non-empty strings?
  for (const field of required) {
    const val = response[field];
    const isNonEmpty = typeof val === 'string' && val.trim().length > 0;
    check(
      `${field}_non_empty`,
      isNonEmpty,
      isNonEmpty ? `${val.length} chars` : `${typeof val}: ${JSON.stringify(val)}`
    );
  }

  // POS is a recognized value?
  if (response.part_of_speech) {
    const normalized = normalizePOS(response.part_of_speech);
    const valid = VALID_POS.has(normalized) || VALID_POS.has(response.part_of_speech.toLowerCase().trim());
    check(
      'pos_valid_value',
      valid,
      `"${response.part_of_speech}" -> normalized: "${normalized}"`
    );
  }

  // Pronunciation looks like IPA?
  if (response.pronunciation) {
    check(
      'pronunciation_ipa',
      looksLikeIPA(response.pronunciation),
      response.pronunciation
    );
  }

  // Definition is reasonable length (not too short, not too long)
  if (response.definition) {
    const len = response.definition.length;
    check(
      'definition_length',
      len >= 10 && len <= 500,
      `${len} chars`
    );
  }

  // Context meaning is reasonable length
  if (response.context_meaning) {
    const len = response.context_meaning.length;
    check(
      'context_meaning_length',
      len >= 15 && len <= 600,
      `${len} chars`
    );
  }

  return results;
}

/**
 * Layer 2: Factual accuracy
 * Does the POS match? Does the definition contain expected keywords?
 */
export function gradeAccuracy(response, testCase) {
  const results = {
    name: 'accuracy',
    checks: [],
    passed: 0,
    total: 0,
  };

  function check(name, pass, detail) {
    results.checks.push({ name, pass, detail });
    results.total++;
    if (pass) results.passed++;
  }

  // POS matches expected?
  if (testCase.expected_pos) {
    const actual = normalizePOS(response.part_of_speech);
    const expected = normalizePOS(testCase.expected_pos);
    check(
      'pos_matches',
      actual === expected,
      `expected "${expected}", got "${actual}" (raw: "${response.part_of_speech}")`
    );
  }

  // Definition contains at least one expected keyword? (exact or stem match)
  if (testCase.expected_definition_keywords && response.definition) {
    const matched = testCase.expected_definition_keywords.filter(kw => keywordFound(kw, response.definition));
    check(
      'definition_keywords',
      matched.length > 0,
      matched.length > 0
        ? `matched: [${matched.join(', ')}]`
        : `none of [${testCase.expected_definition_keywords.join(', ')}] found in: "${response.definition}"`
    );
  }

  // Context meaning contains at least one expected keyword? (exact or stem match)
  if (testCase.expected_context_keywords && response.context_meaning) {
    const matched = testCase.expected_context_keywords.filter(kw => keywordFound(kw, response.context_meaning));
    check(
      'context_keywords',
      matched.length > 0,
      matched.length > 0
        ? `matched: [${matched.join(', ')}]`
        : `none of [${testCase.expected_context_keywords.join(', ')}] found in: "${response.context_meaning}"`
    );
  }

  return results;
}
