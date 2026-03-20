import Dexie from 'dexie';

export const db = new Dexie('LibrarianDB');

db.version(1).stores({
  books: '++id, title, filename, created_at, last_read_at',
  vocabulary: '++id, word, book_id, chapter_index, mastery, next_review_at, created_at',
});

db.version(2).stores({
  books: '++id, title, filename, created_at, last_read_at',
  vocabulary: '++id, word, book_id, chapter_index, mastery, next_review_at, created_at',
}).upgrade((tx) => {
  return tx.table('books').toCollection().modify((book) => {
    if (book.time_spent_ms === undefined) book.time_spent_ms = 0;
    if (book.cover_image === undefined) book.cover_image = null;
  });
});

// v3: add api_usage table to track token usage and costs
db.version(3).stores({
  books: '++id, title, filename, created_at, last_read_at',
  vocabulary: '++id, word, book_id, chapter_index, mastery, next_review_at, created_at',
  api_usage: '++id, model, created_at',
});

// v4: add chats table for chapter-level conversations
db.version(4).stores({
  books: '++id, title, filename, created_at, last_read_at',
  vocabulary: '++id, word, book_id, chapter_index, mastery, next_review_at, created_at',
  api_usage: '++id, model, created_at',
  chats: '++id, book_id, chapter_index, created_at, updated_at',
});

// Log an API usage entry
export async function logApiUsage({ model, prompt_tokens, completion_tokens, feature }) {
  await db.api_usage.add({
    model,
    prompt_tokens,
    completion_tokens,
    feature, // 'definition', 'quiz', 'cover', 'test'
    created_at: Date.now(),
  });
}

// Pricing per 1M tokens (as of early 2025)
const PRICING = {
  'gpt-4o':      { input: 2.50,  output: 10.00 },
  'gpt-4o-mini': { input: 0.15,  output: 0.60 },
  'dall-e-3':    { per_image: 0.04 },
};

export async function getUsageStats() {
  const entries = await db.api_usage.toArray();

  let totalCost = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalCalls = entries.length;
  const byFeature = {};

  for (const entry of entries) {
    const pricing = PRICING[entry.model];
    let cost = 0;

    if (pricing?.per_image) {
      cost = pricing.per_image;
    } else if (pricing) {
      cost = ((entry.prompt_tokens || 0) / 1_000_000) * pricing.input
           + ((entry.completion_tokens || 0) / 1_000_000) * pricing.output;
    }

    totalCost += cost;
    totalPromptTokens += entry.prompt_tokens || 0;
    totalCompletionTokens += entry.completion_tokens || 0;

    const f = entry.feature || 'other';
    if (!byFeature[f]) byFeature[f] = { calls: 0, cost: 0 };
    byFeature[f].calls += 1;
    byFeature[f].cost += cost;
  }

  return { totalCost, totalPromptTokens, totalCompletionTokens, totalCalls, byFeature };
}
