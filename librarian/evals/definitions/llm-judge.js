// LLM-as-judge grader for definition eval
// Uses GPT-4o-mini to evaluate whether the context_meaning is genuinely contextual

const JUDGE_PROMPT = `You are evaluating an AI vocabulary assistant's output. You will be given:
1. A word
2. The paragraph the word appears in
3. The AI's "context_meaning" — its explanation of what the word means in this specific passage

Judge the context_meaning on TWO criteria:

**Criterion 1 — Scene Reference**: Does the context_meaning reference specific details from the paragraph (characters, events, setting, emotions)?
- YES: It mentions something specific to the passage (e.g., "the letter from the front lines", "Elizabeth's frustration")
- NO: It's generic and could apply to any usage of the word

**Criterion 2 — Beyond Dictionary**: Is the context_meaning meaningfully different from a standard dictionary definition? Does it add value by connecting the word to what's happening in the scene?
- YES: It explains WHY the word matters here or WHAT it reveals about the situation
- NO: It just restates the dictionary definition with slightly different words

Respond in JSON only:
{
  "scene_reference": true or false,
  "scene_reference_reason": "brief explanation",
  "beyond_dictionary": true or false,
  "beyond_dictionary_reason": "brief explanation"
}`;

export async function judgeContextQuality({ word, paragraph, contextMeaning, apiKey, model }) {
  const usedModel = model || 'gpt-4o-mini';

  const userMessage = `Word: "${word}"
Paragraph: "${paragraph}"
AI's context_meaning: "${contextMeaning}"`;

  const url = 'https://api.openai.com/v1/chat/completions';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: usedModel,
      messages: [
        { role: 'system', content: JUDGE_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Judge API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;

  // Parse JSON from response
  try {
    const parsed = JSON.parse(content);
    return {
      name: 'llm_judge',
      checks: [
        {
          name: 'scene_reference',
          pass: parsed.scene_reference === true,
          detail: parsed.scene_reference_reason || '',
        },
        {
          name: 'beyond_dictionary',
          pass: parsed.beyond_dictionary === true,
          detail: parsed.beyond_dictionary_reason || '',
        },
      ],
      passed: (parsed.scene_reference === true ? 1 : 0) + (parsed.beyond_dictionary === true ? 1 : 0),
      total: 2,
      tokens: data.usage ? data.usage.prompt_tokens + data.usage.completion_tokens : 0,
    };
  } catch {
    // Try to extract JSON from response
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        name: 'llm_judge',
        checks: [
          {
            name: 'scene_reference',
            pass: parsed.scene_reference === true,
            detail: parsed.scene_reference_reason || '',
          },
          {
            name: 'beyond_dictionary',
            pass: parsed.beyond_dictionary === true,
            detail: parsed.beyond_dictionary_reason || '',
          },
        ],
        passed: (parsed.scene_reference === true ? 1 : 0) + (parsed.beyond_dictionary === true ? 1 : 0),
        total: 2,
        tokens: data.usage ? data.usage.prompt_tokens + data.usage.completion_tokens : 0,
      };
    }
    throw new Error(`Failed to parse judge response: ${content}`);
  }
}
