import { useState, useEffect, useRef } from 'react';
import { db } from '../db';

const MIN_WORDS = 200;

export default function NotesPanel({ bookId, book, chapterIndex, chapterTitle, onNoteSaved, onClose }) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef();

  useEffect(() => {
    const existing = book.notes?.[chapterIndex] || '';
    setText(existing);
    setSaved(false);
  }, [chapterIndex, book]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const remaining = MIN_WORDS - wordCount;
  const isComplete = wordCount >= MIN_WORDS;

  async function handleSave() {
    const notes = { ...(book.notes || {}), [chapterIndex]: text };
    await db.books.update(bookId, { notes });
    if (onNoteSaved) onNoteSaved(notes);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center"
      style={{ background: 'rgba(59,47,42,0.3)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-2xl border flex flex-col"
        style={{
          background: '#FAF6F0',
          borderColor: '#D4C5B0',
          boxShadow: '0 8px 24px rgba(59,47,42,0.15)',
          height: '70vh',
        }}
      >
        <div
          className="shrink-0 flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
        >
          <div>
            <h2 className="text-sm font-bold" style={{ color: '#5C3D2E' }}>
              Chapter Notes — {chapterTitle}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#A89885' }}>
              Write at least {MIN_WORDS} words about what you read before moving to the next chapter.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm px-2 py-1 border"
            style={{ borderColor: '#D4C5B0' }}
          >
            x
          </button>
        </div>

        <div className="flex-1 p-4 flex flex-col">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write your thoughts, summary, or reflections on this chapter..."
            className="flex-1 w-full text-sm p-4 border outline-none resize-none"
            style={{
              borderColor: '#D4C5B0',
              background: '#FAF6F0',
              color: '#3B2F2A',
              lineHeight: 1.7,
              fontFamily: "'EB Garamond', serif",
              fontSize: 16,
            }}
          />

          <div className="flex items-center justify-between mt-3">
            <div className="text-sm" style={{ color: isComplete ? '#4A6741' : '#A89885' }}>
              {wordCount} / {MIN_WORDS} words
              {!isComplete && remaining > 0 && (
                <span style={{ color: '#A89885' }}> — {remaining} more needed</span>
              )}
              {isComplete && ' — Ready to proceed!'}
            </div>
            <div className="flex gap-2">
              {saved && (
                <span className="text-sm" style={{ color: '#4A6741' }}>Saved!</span>
              )}
              <button
                onClick={handleSave}
                disabled={wordCount === 0}
                className="text-sm px-4 py-1.5 text-white disabled:opacity-50"
                style={{ background: '#5C3D2E' }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
