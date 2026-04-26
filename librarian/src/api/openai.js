import { logApiUsage } from '../db';

// The AI may put literal newlines inside JSON string values.
// This fixes them before parsing.
function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    const fixed = str.replace(/("(?:[^"\\]|\\.)*")/g, (match) => {
      return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    });
    return JSON.parse(fixed);
  }
}

function parseJsonResponse(content, errorMsg) {
  try {
    return safeParse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return safeParse(match[0]);
    throw new Error(errorMsg || 'Failed to parse response');
  }
}

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

export async function fetchDefinition({ word, paragraph, bookTitle, bookAuthor, chapterTitle, apiKey, model }) {
  const userMessage = `Word: "${word}"
Paragraph: "${paragraph}"
Book: "${bookTitle}"${bookAuthor ? ` by ${bookAuthor}` : ''}
Chapter: ${chapterTitle}`;

  const usedModel = model || 'gpt-4o';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: usedModel,
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

  // Log usage
  if (data.usage) {
    logApiUsage({
      model: usedModel,
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      feature: 'definition',
    });
  }

  const content = data.choices[0].message.content;
  return parseJsonResponse(content, 'Failed to parse API response');
}

const QUIZ_PROMPT = `You are a reading comprehension quiz generator for someone reading English literature.
Given the text from one or more chapters of a book, generate a quiz to test the reader's understanding.

Generate exactly the number of questions requested. Mix these question types:
- Plot/event recall: What happened? Who did what?
- Character understanding: Why did a character act a certain way? What motivates them?
- Theme/meaning: What is the significance of a scene or symbol?
- Vocabulary in context: What does a specific word or phrase mean as used in the text?

Each question should have 4 options (A, B, C, D) with exactly one correct answer.
Keep the language clear and direct. Don't make trick questions.

Respond in JSON only, no markdown:
{
  "questions": [
    {
      "question": "string",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct": 0,
      "explanation": "string (1-2 sentences explaining why)"
    }
  ]
}`;

export async function generateQuiz({ chapterTexts, bookTitle, bookAuthor, numQuestions, apiKey, model }) {
  const truncated = chapterTexts.map((ch) => {
    const text = ch.content.length > 2000 ? ch.content.slice(0, 2000) + '...' : ch.content;
    return `--- ${ch.title} ---\n${text}`;
  }).join('\n\n');

  const userMessage = `Book: "${bookTitle}"${bookAuthor ? ` by ${bookAuthor}` : ''}
Number of questions: ${numQuestions}

Text:
${truncated}`;

  const usedModel = model || 'gpt-4o';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: usedModel,
      messages: [
        { role: 'system', content: QUIZ_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.usage) {
    logApiUsage({
      model: usedModel,
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      feature: 'quiz',
    });
  }

  const content = data.choices[0].message.content;
  return parseJsonResponse(content, 'Failed to parse quiz response');
}

export async function simplifyText({ text, bookTitle, bookAuthor, chapterTitle, apiKey, model }) {
  const usedModel = model || 'gpt-4o';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: usedModel,
      messages: [
        {
          role: 'system',
          content: `You help people understand hard-to-read passages from books. Rewrite the passage in simple, everyday English — like you're explaining it to a high school student. Keep the same meaning but use short sentences and easy words. No fancy vocabulary.

CRITICAL RULE — CHARACTER ACCURACY:
- You MUST carefully read the original passage to determine who is speaking each line.
- Look at dialogue tags like "said Lord Henry", "he answered", "replied Basil" to identify speakers.
- Do NOT guess or swap characters. If Lord Henry says something in the original, it MUST be Lord Henry in your version too.

MANDATORY FORMATTING — YOU MUST FOLLOW THIS:
- Any time a character speaks (dialogue in quotes), you MUST put it on its own line with the speaker's name.
- Format: **Name:** "what they say"
- Narration goes on its own line too.
- Use \\n to separate lines in the JSON string.
- NEVER combine multiple characters' dialogue into one paragraph. Each speaker gets their own line.
- If there is NO dialogue at all, just write normal text.

EXAMPLE of correct output for a passage with dialogue:
**Lord Henry:** "This is amazing! I have to meet him."\\n\\nHallward stood up and walked around.\\n\\n**Basil:** "You don't understand, Harry. He's just part of my art."\\n\\n**Lord Henry:** "Then why won't you show the portrait?"\\n\\n**Basil:** "Because I put too much of myself into it."

Then explain what's going on — who's talking, what they mean, and why it matters in the story. Keep it casual and clear.

Don't use words like: assertion, embodies, juxtaposition, aesthetic, hedonistic, dichotomy, paradigm, inherently, fundamentally, nuanced.

Respond in JSON only, no markdown:
{
  "simplified": "string (passage rewritten in simple English, MUST use \\n for line breaks between dialogue)",
  "explanation": "string (2-4 simple sentences: what's happening, who's involved, why it matters)"
}`
        },
        {
          role: 'user',
          content: `Book: "${bookTitle}"${bookAuthor ? ` by ${bookAuthor}` : ''}
Chapter: ${chapterTitle}

Passage:
"${text}"`
        },
      ],
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.usage) {
    logApiUsage({
      model: usedModel,
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      feature: 'simplify',
    });
  }

  const content = data.choices[0].message.content;
  return parseJsonResponse(content, 'Failed to parse response');
}

export async function generateCoverImage({ title, author, apiKey }) {
  const prompt = `A vintage, antique-style book cover illustration for "${title}"${author ? ` by ${author}` : ''}. Elegant, muted warm tones (sepia, cream, brown, gold), classical engraving style, no text, decorative botanical or architectural motifs, old library aesthetic. Square format.`;

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Image generation failed: ${response.status}`);
  }

  logApiUsage({
    model: 'dall-e-3',
    prompt_tokens: 0,
    completion_tokens: 0,
    feature: 'cover',
  });

  const data = await response.json();
  return `data:image/png;base64,${data.data[0].b64_json}`;
}

const CHAT_SYSTEM_PROMPT = `You are a friendly reading buddy helping someone understand a book. You have the chapter text they're reading right now.

IMPORTANT RULES FOR HOW YOU WRITE:
- Use simple, everyday English. Write like you're explaining to a high school student.
- NO fancy vocabulary. If you'd use "hedonistic", say "pleasure-seeking" instead. If you'd use "embodies", say "represents" or "shows". If you'd use "disdain", say "looks down on".
- Keep sentences short. One idea per sentence.
- Use examples and comparisons to everyday life to make things click.
- Be direct. Say "Lord Henry is basically saying..." not "Lord Henry's assertion suggests that..."
- Don't use words like: assertion, embodies, disdain, aesthetic, hedonistic, juxtaposition, dichotomy, paradigm, discourse, inherently, fundamentally, nuanced, multifaceted.
- DO use words like: basically, really, pretty much, thinks, says, means, shows, wants, feels, because.

You can help with:
- What's happening in a scene
- What characters are like and why they do things
- What the author is trying to say
- Words or phrases that are hard to understand
- Historical or cultural stuff the reader might not know

Be like a friend who read the book and is explaining it casually over lunch.`;

export async function chatWithBook({ messages, chapterText, bookTitle, bookAuthor, chapterTitle, apiKey, model }) {
  const usedModel = model || 'gpt-4o';

  const systemMessage = `${CHAT_SYSTEM_PROMPT}

Book: "${bookTitle}"${bookAuthor ? ` by ${bookAuthor}` : ''}
Chapter: ${chapterTitle}

--- Chapter Text ---
${chapterText.length > 6000 ? chapterText.slice(0, 6000) + '...' : chapterText}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: usedModel,
      messages: [
        { role: 'system', content: systemMessage },
        ...messages,
      ],
      temperature: 0.5,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.usage) {
    logApiUsage({
      model: usedModel,
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      feature: 'chat',
    });
  }

  return data.choices[0].message.content;
}

export async function testApiKey(apiKey) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say "ok"' }],
      max_tokens: 5,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Invalid API key');
  }

  const data = await response.json();

  if (data.usage) {
    logApiUsage({
      model: 'gpt-4o-mini',
      prompt_tokens: data.usage.prompt_tokens,
      completion_tokens: data.usage.completion_tokens,
      feature: 'test',
    });
  }

  return true;
}
