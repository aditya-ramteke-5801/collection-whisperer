import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { simplifyText } from '../api/openai';

export default function SimplifyPopup({ text, bookTitle, bookAuthor, chapterTitle, onClose }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const apiKey = useStore((s) => s.apiKey);
  const model = useStore((s) => s.model);
  const ref = useRef();

  useEffect(() => {
    fetchSimplification();
  }, [text]);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  async function fetchSimplification() {
    setLoading(true);
    setError('');

    if (!apiKey) {
      setError('No API key set. Open Settings to add your OpenAI API key.');
      setLoading(false);
      return;
    }

    try {
      const result = await simplifyText({
        text,
        bookTitle,
        bookAuthor,
        chapterTitle,
        apiKey,
        model,
      });
      setData(result);
    } catch (err) {
      setError(err.message || "Couldn't simplify this text. Check your API key or internet connection.");
    } finally {
      setLoading(false);
    }
  }

  function renderFormatted(text) {
    if (!text) return null;
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    return lines.map((line, i) => {
      // Handle dialogue: **Name:** or **Name**: or Name: at start of line
      // Pattern covers: **Basil:** "...", **Lord Henry:**: "...", **Basil**:  "..."
      const boldMatch = line.match(/^\*\*(.+?):?\*\*:*\s*(.*)/);
      if (boldMatch) {
        const name = boldMatch[1].replace(/:+$/, ''); // strip trailing colons from name
        return (
          <p key={i} style={{ marginBottom: '0.8em' }}>
            <strong style={{ color: '#5C3D2E' }}>{name}:</strong> {boldMatch[2]}
          </p>
        );
      }
      // Also handle non-bold "Name:" at start (narration attributed to someone)
      // but only for known short patterns to avoid false matches
      return <p key={i} style={{ marginBottom: '0.8em' }}>{renderInlineBold(line)}</p>;
    });
  }

  function renderInlineBold(text) {
    // Replace any remaining **text** with bold spans
    const parts = [];
    let lastIndex = 0;
    const regex = /\*\*(.+?)\*\*/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      parts.push(<strong key={match.index} style={{ color: '#5C3D2E' }}>{match[1]}</strong>);
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts.length > 0 ? parts : text;
  }

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center"
      style={{ background: 'rgba(59,47,42,0.3)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        className="w-full max-w-xl border"
        style={{
          background: '#FAF6F0',
          borderColor: '#D4C5B0',
          borderLeft: '3px solid #5C3D2E',
          boxShadow: '0 8px 24px rgba(59,47,42,0.15)',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        {loading ? (
          <div className="p-6 space-y-4">
            <div className="shimmer h-4 w-48" />
            <div className="shimmer h-20 w-full" />
            <div className="shimmer h-16 w-full" />
          </div>
        ) : error ? (
          <div className="p-6">
            <p style={{ color: '#8B3A3A' }}>{error}</p>
            <button
              onClick={fetchSimplification}
              className="mt-3 px-3 py-1 border text-sm"
              style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
            >
              Retry
            </button>
          </div>
        ) : data ? (
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-base" style={{ color: '#5C3D2E' }}>Help Me Understand</h2>
              <button
                onClick={onClose}
                className="text-sm px-2 py-1 border"
                style={{ borderColor: '#D4C5B0' }}
              >
                x
              </button>
            </div>

            <div className="mb-4 p-3 border" style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}>
              <div className="font-bold text-[10px] uppercase mb-1" style={{ color: '#A89885', letterSpacing: '0.1em' }}>Original Passage</div>
              <p className="text-sm italic" style={{ color: '#5C3D2E', lineHeight: 1.6 }}>{text}</p>
            </div>

            <div className="mb-4">
              <div className="font-bold text-[10px] uppercase mb-2" style={{ color: '#A89885', letterSpacing: '0.1em' }}>In Simple English</div>
              <div className="text-sm" style={{ color: '#3B2F2A', lineHeight: 1.7 }}>
                {renderFormatted(data.simplified)}
              </div>
            </div>

            <div className="mb-4">
              <div className="font-bold text-[10px] uppercase mb-2" style={{ color: '#A89885', letterSpacing: '0.1em' }}>What's Happening</div>
              <p className="text-sm" style={{ color: '#3B2F2A', lineHeight: 1.7 }}>{data.explanation}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
