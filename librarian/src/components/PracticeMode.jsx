import { useState, useMemo } from 'react';
import { db } from '../db';
import { gradeWord, isDueForReview } from '../utils/spaced-repetition';

export default function PracticeMode({ vocab, onClose }) {
  const queue = useMemo(() => {
    const due = vocab.filter(isDueForReview);
    const remaining = vocab.filter((v) => !isDueForReview(v));
    const pool = [...due, ...remaining].slice(0, 15);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
  }, [vocab]);

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState([]);
  const [done, setDone] = useState(false);

  if (queue.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF6F0' }}>
        <div className="text-center">
          <p className="text-base mb-4">No words to practice.</p>
          <button onClick={onClose} className="text-sm px-4 py-2 text-white" style={{ background: '#5C3D2E' }}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const current = queue[index];

  async function handleGrade(grade) {
    const { mastery, next_review_at } = gradeWord(current.mastery, grade);
    await db.vocabulary.update(current.id, {
      mastery,
      next_review_at,
      review_count: (current.review_count || 0) + 1,
    });

    const newResults = [...results, { word: current.word, grade }];
    setResults(newResults);

    if (index + 1 >= queue.length) {
      setDone(true);
    } else {
      setIndex(index + 1);
      setRevealed(false);
    }
  }

  if (done) {
    const correct = results.filter((r) => r.grade !== 'forgot').length;
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAF6F0' }}>
        <div className="text-center max-w-sm">
          <h2 className="text-base font-bold mb-4" style={{ color: '#5C3D2E' }}>Practice Complete</h2>
          <p className="text-3xl font-bold mb-2">{correct}/{results.length}</p>
          <p className="text-sm mb-6" style={{ color: '#7A6B5D' }}>words recalled correctly</p>
          <button onClick={onClose} className="text-sm px-4 py-2 text-white" style={{ background: '#5C3D2E' }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: '#FAF6F0' }}>
      <div className="text-sm mb-4" style={{ color: '#A89885' }}>
        {index + 1} / {queue.length}
      </div>

      <div className="w-full max-w-md border p-8 text-center" style={{ borderColor: '#D4C5B0', background: '#FAF6F0' }}>
        <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: "'EB Garamond', serif", color: '#5C3D2E' }}>
          {current.word}
        </h2>
        <p className="text-sm mb-4" style={{ color: '#A89885' }}>{current.pronunciation} · {current.part_of_speech}</p>

        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="text-sm px-6 py-2 text-white mt-4"
            style={{ background: '#5C3D2E' }}
          >
            Show Answer
          </button>
        ) : (
          <>
            <div className="text-left mt-4 mb-6">
              <div className="text-xs font-bold mb-1" style={{ color: '#A89885', letterSpacing: '0.1em' }}>MEANING</div>
              <p className="text-base" style={{ fontFamily: "'EB Garamond', serif" }}>{current.definition}</p>

              {current.context_meaning && (
                <>
                  <div className="text-xs font-bold mt-3 mb-1" style={{ color: '#A89885', letterSpacing: '0.1em' }}>IN CONTEXT</div>
                  <p className="text-base" style={{ fontFamily: "'EB Garamond', serif" }}>{current.context_meaning}</p>
                </>
              )}
            </div>

            <div className="flex gap-2 justify-center">
              <button onClick={() => handleGrade('forgot')} className="text-sm px-4 py-2 border" style={{ borderColor: '#C47A7A', color: '#8B3A3A' }}>
                Forgot
              </button>
              <button onClick={() => handleGrade('hard')} className="text-sm px-4 py-2 border" style={{ borderColor: '#D4C5B0' }}>
                Hard
              </button>
              <button onClick={() => handleGrade('easy')} className="text-sm px-4 py-2 text-white" style={{ background: '#5C3D2E' }}>
                Easy
              </button>
            </div>
          </>
        )}
      </div>

      <button onClick={onClose} className="mt-6 text-sm" style={{ color: '#A89885' }}>
        End practice
      </button>
    </div>
  );
}
