import { useState } from 'react';

function isNoteComplete(book, chapterIdx) {
  if (!book) return false;
  const chTitle = book.chapters[chapterIdx]?.title || '';
  if (chTitle === 'Front Matter' || chTitle === 'Back Matter') return true;
  const note = (book.notes || {})[chapterIdx] || '';
  return note.trim().split(/\s+/).filter(Boolean).length >= 200;
}

function isChapterUnlocked(book, chapterIdx) {
  if (!book) return false;
  const ch = book.chapters[chapterIdx];
  if (!ch) return false;
  if (ch.title === 'Front Matter' || ch.title === 'Back Matter') return true;
  // Chapter 0 (or first real chapter) is always unlocked
  // A chapter is unlocked if all previous chapters have completed notes
  for (let i = 0; i < chapterIdx; i++) {
    if (!isNoteComplete(book, i)) return false;
  }
  return true;
}

export default function ChapterSidebar({ chapters, currentChapter, onChapterSelect, onOpenNotes, open, book }) {
  const [tab, setTab] = useState('chapters');

  if (!open) return null;

  return (
    <aside
      className="w-60 shrink-0 border-r overflow-y-auto flex flex-col"
      style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
    >
      <div className="flex border-b" style={{ borderColor: '#D4C5B0' }}>
        <button
          onClick={() => setTab('chapters')}
          className="flex-1 py-2 text-sm font-bold"
          style={{
            background: tab === 'chapters' ? '#FAF6F0' : 'transparent',
            color: tab === 'chapters' ? '#5C3D2E' : '#A89885',
            borderBottom: tab === 'chapters' ? '2px solid #5C3D2E' : '2px solid transparent',
          }}
        >
          Chapters
        </button>
        <button
          onClick={() => setTab('notes')}
          className="flex-1 py-2 text-sm font-bold"
          style={{
            background: tab === 'notes' ? '#FAF6F0' : 'transparent',
            color: tab === 'notes' ? '#5C3D2E' : '#A89885',
            borderBottom: tab === 'notes' ? '2px solid #5C3D2E' : '2px solid transparent',
          }}
        >
          Notes
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'chapters' && (
          <div className="py-1">
            {chapters.map((ch, idx) => {
              const unlocked = isChapterUnlocked(book, idx);
              return (
                <button
                  key={idx}
                  onClick={() => onChapterSelect(idx)}
                  className="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[#FAF6F0] flex items-center justify-between"
                  style={{
                    borderLeft: idx === currentChapter ? '3px solid #5C3D2E' : '3px solid transparent',
                    color: unlocked ? (idx === currentChapter ? '#5C3D2E' : '#3B2F2A') : '#A89885',
                    fontWeight: idx === currentChapter ? 'bold' : 'normal',
                  }}
                >
                  <span>{ch.title}</span>
                  {!unlocked && <span style={{ fontSize: 14, color: '#A89885' }}>&#128274;</span>}
                </button>
              );
            })}
          </div>
        )}

        {tab === 'notes' && (
          <div className="py-1">
            {chapters.map((ch, idx) => {
              if (ch.title === 'Front Matter' || ch.title === 'Back Matter') return null;
              const note = (book?.notes || {})[idx] || '';
              const wc = note.trim() ? note.trim().split(/\s+/).length : 0;
              const done = wc >= 200;
              return (
                <button
                  key={idx}
                  onClick={() => { onChapterSelect(idx); onOpenNotes(idx); }}
                  className="w-full text-left px-4 py-2 text-sm transition-colors border-b hover:bg-[#FAF6F0]"
                  style={{
                    borderColor: '#D4C5B0',
                    borderLeft: idx === currentChapter ? '3px solid #5C3D2E' : '3px solid transparent',
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span style={{ color: done ? '#4A6741' : '#5C3D2E', fontWeight: idx === currentChapter ? 'bold' : 'normal' }}>
                      {ch.title}
                    </span>
                    {done && <span style={{ color: '#4A6741' }}>&#10003;</span>}
                  </span>
                  <span className="block mt-0.5 text-xs" style={{ color: done ? '#4A6741' : '#A89885' }}>
                    {wc} / 200 words
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
