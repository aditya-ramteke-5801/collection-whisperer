import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';
import { generateCoverSvg } from '../utils/cover-generator';

function formatTime(ms) {
  if (!ms || ms < 60000) return '< 1m';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function BookCard({ book, onDelete, onRename }) {
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [titleInput, setTitleInput] = useState(book.title);

  const progress = book.chapters.length > 0
    ? Math.round(((book.current_chapter + 1) / book.chapters.length) * 100)
    : 0;

  const coverSrc = book.cover_image || generateCoverSvg(book.title, book.author);

  async function handleRename(e) {
    e.preventDefault();
    const newTitle = titleInput.trim();
    if (newTitle && newTitle !== book.title) {
      await db.books.update(book.id, { title: newTitle });
      if (onRename) onRename();
    }
    setRenaming(false);
  }

  return (
    <div
      onClick={() => !renaming && navigate(`/book/${book.id}`)}
      className="relative group cursor-pointer border transition-colors hover:border-[#5C3D2E] overflow-hidden"
      style={{ background: '#FAF6F0', borderColor: '#D4C5B0' }}
    >
      {/* Cover image */}
      <div className="w-full h-40 overflow-hidden" style={{ background: '#F3ECE0' }}>
        <img src={coverSrc} alt={book.title} className="w-full h-full object-cover" />
      </div>

      {/* Actions */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); setRenaming(true); setTitleInput(book.title); }}
          className="text-xs px-1.5 py-0.5 border"
          style={{ background: '#F3ECE0', borderColor: '#D4C5B0', color: '#5C3D2E' }}
        >
          ✎
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(book.id); }}
          className="text-xs px-1.5 py-0.5 border"
          style={{ background: '#F3ECE0', borderColor: '#D4C5B0', color: '#A89885' }}
        >
          x
        </button>
      </div>

      <div className="p-4">
        {renaming ? (
          <form onSubmit={handleRename} onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleRename}
              className="w-full text-sm font-bold border-b outline-none pb-1"
              style={{ color: '#5C3D2E', borderColor: '#D4C5B0', background: 'transparent' }}
            />
          </form>
        ) : (
          <h3 className="text-sm font-bold truncate" style={{ color: '#5C3D2E' }}>
            {book.title}
          </h3>
        )}
        {book.author && (
          <p className="text-xs mt-1 truncate" style={{ color: '#7A6B5D' }}>{book.author}</p>
        )}

        <div className="mt-3 text-xs" style={{ color: '#A89885' }}>
          <div className="flex justify-between">
            <span>{formatTime(book.time_spent_ms)} read</span>
            <span>Ch {book.current_chapter + 1}/{book.chapters.length}</span>
          </div>
          <div className="mt-1 h-1 w-full" style={{ background: '#D4C5B0' }}>
            <div className="h-full" style={{ width: `${progress}%`, background: '#5C3D2E' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
