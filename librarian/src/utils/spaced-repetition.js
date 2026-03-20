const INTERVALS = {
  new: 1,        // 1 day
  learning: 3,   // 3 days
  familiar: 7,   // 7 days
  mastered: 30,  // 30 days
};

const PROMOTION = {
  new: 'learning',
  learning: 'familiar',
  familiar: 'mastered',
  mastered: 'mastered',
};

export function getNextReview(mastery) {
  const days = INTERVALS[mastery] || 1;
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next.getTime();
}

export function gradeWord(currentMastery, grade) {
  // grade: 'forgot' | 'hard' | 'easy'
  if (grade === 'forgot') return { mastery: 'new', next_review_at: getNextReview('new') };
  if (grade === 'hard') return { mastery: currentMastery, next_review_at: getNextReview(currentMastery) };
  // easy — promote
  const newMastery = PROMOTION[currentMastery] || 'learning';
  return { mastery: newMastery, next_review_at: getNextReview(newMastery) };
}

export function isDueForReview(vocab) {
  return vocab.next_review_at <= Date.now();
}
