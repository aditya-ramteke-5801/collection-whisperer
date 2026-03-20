import { useState } from 'react';
import { useStore } from '../store';
import { generateQuiz } from '../api/openai';

export default function QuizMode({ book, onClose }) {
  const apiKey = useStore((s) => s.apiKey);
  const model = useStore((s) => s.model);

  const [phase, setPhase] = useState('select');
  const [selectedChapters, setSelectedChapters] = useState([]);
  const [numQuestions, setNumQuestions] = useState(5);
  const [questions, setQuestions] = useState([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState('');

  function toggleChapter(idx) {
    setSelectedChapters((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  }

  function selectAll() {
    if (selectedChapters.length === book.chapters.length) {
      setSelectedChapters([]);
    } else {
      setSelectedChapters(book.chapters.map((_, i) => i));
    }
  }

  async function handleGenerate() {
    if (selectedChapters.length === 0) return;
    if (!apiKey) { setError('No API key set. Open Settings to add your OpenAI API key.'); return; }

    setPhase('loading');
    setError('');

    try {
      const chapterTexts = selectedChapters
        .sort((a, b) => a - b)
        .map((idx) => book.chapters[idx]);

      const result = await generateQuiz({
        chapterTexts,
        bookTitle: book.title,
        bookAuthor: book.author,
        numQuestions,
        apiKey,
        model,
      });

      setQuestions(result.questions);
      setCurrentQ(0);
      setAnswers({});
      setRevealed(false);
      setPhase('quiz');
    } catch (err) {
      setError(err.message || 'Failed to generate quiz.');
      setPhase('select');
    }
  }

  function handleAnswer(optionIdx) {
    if (answers[currentQ] !== undefined) return;
    setAnswers((prev) => ({ ...prev, [currentQ]: optionIdx }));
    setRevealed(true);
  }

  function handleNext() {
    if (currentQ + 1 >= questions.length) {
      setPhase('results');
    } else {
      setCurrentQ(currentQ + 1);
      setRevealed(false);
    }
  }

  const score = Object.entries(answers).filter(
    ([qIdx, aIdx]) => questions[qIdx]?.correct === aIdx
  ).length;

  // --- CHAPTER SELECTION ---
  if (phase === 'select') {
    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center" style={{ background: 'rgba(59,47,42,0.3)' }}>
        <div className="w-full max-w-lg border p-6 max-h-[80vh] flex flex-col" style={{ background: '#FAF6F0', borderColor: '#D4C5B0' }}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-base font-bold" style={{ color: '#5C3D2E' }}>Quiz Me</h2>
            <button onClick={onClose} className="text-sm px-2 py-1 border" style={{ borderColor: '#D4C5B0' }}>x</button>
          </div>

          <p className="text-sm mb-3" style={{ color: '#7A6B5D' }}>Select chapters to be tested on:</p>

          {error && (
            <div className="mb-3 p-2 text-sm border" style={{ borderColor: '#C47A7A', background: '#F5E0E0', color: '#8B3A3A' }}>
              {error}
            </div>
          )}

          <div className="flex-1 overflow-y-auto border mb-4" style={{ borderColor: '#D4C5B0' }}>
            <button
              onClick={selectAll}
              className="w-full text-left px-4 py-2 text-sm border-b font-bold hover:bg-[#F3ECE0]"
              style={{ borderColor: '#D4C5B0', color: '#5C3D2E' }}
            >
              <span className="inline-block w-4 mr-2 text-center">
                {selectedChapters.length === book.chapters.length ? '■' : '□'}
              </span>
              Select all
            </button>

            {book.chapters.map((ch, idx) => (
              <button
                key={idx}
                onClick={() => toggleChapter(idx)}
                className="w-full text-left px-4 py-2 text-sm border-b hover:bg-[#F3ECE0]"
                style={{ borderColor: '#D4C5B0', color: selectedChapters.includes(idx) ? '#5C3D2E' : '#3B2F2A' }}
              >
                <span className="inline-block w-4 mr-2 text-center">
                  {selectedChapters.includes(idx) ? '■' : '□'}
                </span>
                {ch.title}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: '#7A6B5D' }}>Questions:</span>
              <select
                value={numQuestions}
                onChange={(e) => setNumQuestions(parseInt(e.target.value))}
                className="border px-2 py-1 outline-none"
                style={{ borderColor: '#D4C5B0', background: '#FAF6F0' }}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
              </select>
            </div>

            <button
              onClick={handleGenerate}
              disabled={selectedChapters.length === 0}
              className="text-sm px-4 py-2 text-white disabled:opacity-50"
              style={{ background: '#5C3D2E' }}
            >
              Generate Quiz
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- LOADING ---
  if (phase === 'loading') {
    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center" style={{ background: 'rgba(59,47,42,0.3)' }}>
        <div className="w-full max-w-md border p-8 text-center" style={{ background: '#FAF6F0', borderColor: '#D4C5B0' }}>
          <div className="mb-4">
            <div className="shimmer h-4 w-48 mx-auto mb-3" />
            <div className="shimmer h-3 w-64 mx-auto mb-2" />
            <div className="shimmer h-3 w-56 mx-auto" />
          </div>
          <p className="text-sm" style={{ color: '#A89885' }}>Generating questions from {selectedChapters.length} chapter{selectedChapters.length > 1 ? 's' : ''}...</p>
        </div>
      </div>
    );
  }

  // --- QUIZ ---
  if (phase === 'quiz') {
    const q = questions[currentQ];
    const userAnswer = answers[currentQ];
    const isCorrect = userAnswer === q.correct;

    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center" style={{ background: 'rgba(59,47,42,0.3)' }}>
        <div className="w-full max-w-lg border p-6" style={{ background: '#FAF6F0', borderColor: '#D4C5B0' }}>
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm" style={{ color: '#A89885' }}>
              Question {currentQ + 1} of {questions.length}
            </span>
            <button onClick={onClose} className="text-sm px-2 py-1 border" style={{ borderColor: '#D4C5B0' }}>x</button>
          </div>

          <div className="flex gap-1 mb-4">
            {questions.map((_, i) => (
              <div
                key={i}
                className="h-1 flex-1"
                style={{
                  background:
                    answers[i] === undefined ? '#D4C5B0'
                    : answers[i] === questions[i].correct ? '#5A7D50'
                    : '#A04040',
                }}
              />
            ))}
          </div>

          <p className="text-base mb-4" style={{ fontFamily: "'EB Garamond', serif", color: '#3B2F2A' }}>
            {q.question}
          </p>

          <div className="space-y-2 mb-4">
            {q.options.map((opt, i) => {
              let bg = '#F3ECE0';
              let border = '#D4C5B0';
              let color = '#3B2F2A';

              if (revealed) {
                if (i === q.correct) { bg = '#E8F0E4'; border = '#5A7D50'; color = '#4A6741'; }
                else if (i === userAnswer && !isCorrect) { bg = '#F5E0E0'; border = '#A04040'; color = '#8B3A3A'; }
              } else if (i === userAnswer) {
                bg = '#EDE4D4'; border = '#5C3D2E';
              }

              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={revealed}
                  className="w-full text-left px-4 py-3 text-sm border transition-colors disabled:cursor-default"
                  style={{ background: bg, borderColor: border, color }}
                >
                  {opt}
                </button>
              );
            })}
          </div>

          {revealed && (
            <div className="mb-4 p-3 text-sm" style={{ background: '#F3ECE0', borderLeft: '3px solid #5C3D2E' }}>
              <span className="font-bold" style={{ color: isCorrect ? '#4A6741' : '#8B3A3A' }}>
                {isCorrect ? 'Correct!' : 'Incorrect.'}
              </span>{' '}
              <span style={{ color: '#7A6B5D' }}>{q.explanation}</span>
            </div>
          )}

          {revealed && (
            <div className="flex justify-end">
              <button
                onClick={handleNext}
                className="text-sm px-4 py-2 text-white"
                style={{ background: '#5C3D2E' }}
              >
                {currentQ + 1 >= questions.length ? 'See Results' : 'Next'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- RESULTS ---
  if (phase === 'results') {
    const pct = Math.round((score / questions.length) * 100);

    return (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center" style={{ background: 'rgba(59,47,42,0.3)' }}>
        <div className="w-full max-w-md border p-8 text-center" style={{ background: '#FAF6F0', borderColor: '#D4C5B0' }}>
          <h2 className="text-base font-bold mb-4" style={{ color: '#5C3D2E' }}>Quiz Complete</h2>

          <p className="text-4xl font-bold mb-1">{score}/{questions.length}</p>
          <p className="text-sm mb-6" style={{ color: '#7A6B5D' }}>{pct}% correct</p>

          <div className="text-left border mb-6" style={{ borderColor: '#D4C5B0' }}>
            {questions.map((q, i) => {
              const correct = answers[i] === q.correct;
              return (
                <div key={i} className="flex items-start gap-2 px-3 py-2 text-sm border-b" style={{ borderColor: '#D4C5B0' }}>
                  <span style={{ color: correct ? '#5A7D50' : '#A04040', flexShrink: 0 }}>
                    {correct ? '✓' : '✗'}
                  </span>
                  <span className="truncate" style={{ color: '#3B2F2A' }}>{q.question}</span>
                </div>
              );
            })}
          </div>

          <div className="flex gap-2 justify-center">
            <button
              onClick={() => { setPhase('select'); setSelectedChapters([]); }}
              className="text-sm px-4 py-2 border"
              style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
            >
              New Quiz
            </button>
            <button onClick={onClose} className="text-sm px-4 py-2 text-white" style={{ background: '#5C3D2E' }}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
