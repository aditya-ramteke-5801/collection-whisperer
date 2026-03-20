import { useState, useEffect, useRef } from 'react';
import { db } from '../db';
import { useStore } from '../store';
import { fetchDefinition } from '../api/openai';
import { getNextReview } from '../utils/spaced-repetition';

export default function DefinitionPopup({ word, paragraph, bookId, bookTitle, bookAuthor, chapterTitle, chapterIndex, position, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [existing, setExisting] = useState(null);
  const apiKey = useStore((s) => s.apiKey);
  const model = useStore((s) => s.model);
  const ref = useRef();

  useEffect(() => {
    lookupWord();
  }, [word]);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === 's' || e.key === 'S') {
        if (data && !existing) handleSave();
      }
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [data, existing]);

  async function lookupWord() {
    setLoading(true);
    setError('');

    const saved = await db.vocabulary
      .where('word').equalsIgnoreCase(word)
      .and((v) => v.book_id === bookId)
      .first();

    if (saved) {
      setExisting(saved);
      setData({
        pronunciation: saved.pronunciation,
        part_of_speech: saved.part_of_speech,
        definition: saved.definition,
        context_meaning: saved.context_meaning,
      });
      setLoading(false);
      return;
    }

    if (!apiKey) {
      setError('No API key set. Open Settings to add your OpenAI API key.');
      setLoading(false);
      return;
    }

    try {
      const result = await fetchDefinition({
        word,
        paragraph,
        bookTitle,
        bookAuthor,
        chapterTitle,
        apiKey,
        model,
      });
      setData(result);
    } catch (err) {
      setError(err.message || "Couldn't fetch definition. Check your API key or internet connection.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!data) return;
    await db.vocabulary.add({
      word: word.toLowerCase(),
      pronunciation: data.pronunciation,
      part_of_speech: data.part_of_speech,
      definition: data.definition,
      context_meaning: data.context_meaning,
      context_paragraph: paragraph,
      book_id: bookId,
      chapter_index: chapterIndex,
      mastery: 'new',
      next_review_at: getNextReview('new'),
      review_count: 0,
      created_at: Date.now(),
    });
    if (onSaved) onSaved(word.toLowerCase());
    onClose();
  }

  async function handleRemove() {
    if (existing) {
      await db.vocabulary.delete(existing.id);
      if (onSaved) onSaved(null);
      onClose();
    }
  }

  const style = {
    position: 'fixed',
    zIndex: 1000,
    left: Math.min(position.x, window.innerWidth - 360),
    width: 340,
    background: '#FAF6F0',
    border: '1px solid #D4C5B0',
    borderLeft: '3px solid #5C3D2E',
    boxShadow: '0 4px 12px rgba(59,47,42,0.12)',
  };

  if (position.y + 300 < window.innerHeight) {
    style.top = position.y + 8;
  } else {
    style.bottom = window.innerHeight - position.y + 8;
  }

  return (
    <div ref={ref} style={style} className="text-sm">
      {loading ? (
        <div className="p-4 space-y-3">
          <div className="shimmer h-4 w-32" />
          <div className="shimmer h-3 w-48" />
          <div className="shimmer h-12 w-full" />
          <div className="shimmer h-12 w-full" />
        </div>
      ) : error ? (
        <div className="p-4">
          <p style={{ color: '#8B3A3A' }}>{error}</p>
          <button
            onClick={lookupWord}
            className="mt-2 px-3 py-1 border text-sm"
            style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <div className="p-4">
          <div className="font-bold text-base" style={{ color: '#5C3D2E' }}>{word}</div>
          <div className="mt-0.5" style={{ color: '#7A6B5D' }}>
            {data.pronunciation} · {data.part_of_speech}
          </div>

          <div className="mt-3">
            <div className="font-bold mb-1 text-xs" style={{ color: '#A89885', letterSpacing: '0.1em' }}>MEANING</div>
            <p style={{ color: '#3B2F2A' }}>{data.definition}</p>
          </div>

          <div className="mt-3">
            <div className="font-bold mb-1 text-xs" style={{ color: '#A89885', letterSpacing: '0.1em' }}>IN THIS CONTEXT</div>
            <p style={{ color: '#3B2F2A' }}>{data.context_meaning}</p>
          </div>

          <div className="flex gap-2 mt-4">
            {existing ? (
              <button
                onClick={handleRemove}
                className="px-3 py-1.5 border text-sm"
                style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
              >
                Remove from vocabulary
              </button>
            ) : (
              <button
                onClick={handleSave}
                className="px-3 py-1.5 text-sm text-white"
                style={{ background: '#5C3D2E' }}
              >
                Save
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 border text-sm"
              style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
