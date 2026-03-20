import { useState, useEffect } from 'react';
import { db } from '../db';

export default function ChapterSidebar({ chapters, currentChapter, vocabWords, onChapterSelect, onVocabClick, onOpenChat, open, bookId }) {
  const [tab, setTab] = useState('chapters');
  const [chats, setChats] = useState([]);

  useEffect(() => {
    if (bookId) loadChats();
  }, [bookId, currentChapter]);

  async function loadChats() {
    const all = await db.chats
      .where('book_id').equals(bookId)
      .and((c) => c.chapter_index === currentChapter)
      .reverse()
      .sortBy('updated_at');
    setChats(all);
  }

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
          onClick={() => setTab('vocabulary')}
          className="flex-1 py-2 text-sm font-bold"
          style={{
            background: tab === 'vocabulary' ? '#FAF6F0' : 'transparent',
            color: tab === 'vocabulary' ? '#5C3D2E' : '#A89885',
            borderBottom: tab === 'vocabulary' ? '2px solid #5C3D2E' : '2px solid transparent',
          }}
        >
          Vocab ({vocabWords.length})
        </button>
        <button
          onClick={() => setTab('chats')}
          className="flex-1 py-2 text-sm font-bold"
          style={{
            background: tab === 'chats' ? '#FAF6F0' : 'transparent',
            color: tab === 'chats' ? '#5C3D2E' : '#A89885',
            borderBottom: tab === 'chats' ? '2px solid #5C3D2E' : '2px solid transparent',
          }}
        >
          Chats {chats.length > 0 ? `(${chats.length})` : ''}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'chapters' && (
          <div className="py-1">
            {chapters.map((ch, idx) => (
              <button
                key={idx}
                onClick={() => onChapterSelect(idx)}
                className="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[#FAF6F0]"
                style={{
                  borderLeft: idx === currentChapter ? '3px solid #5C3D2E' : '3px solid transparent',
                  color: idx === currentChapter ? '#5C3D2E' : '#3B2F2A',
                  fontWeight: idx === currentChapter ? 'bold' : 'normal',
                }}
              >
                {ch.title}
              </button>
            ))}
          </div>
        )}

        {tab === 'vocabulary' && (
          <div className="py-1">
            {vocabWords.length === 0 ? (
              <p className="px-4 py-3 text-sm" style={{ color: '#A89885' }}>
                No words saved yet. Highlight a word while reading to look it up.
              </p>
            ) : (
              vocabWords.map((v) => (
                <button
                  key={v.id}
                  onClick={() => onVocabClick(v)}
                  className="w-full text-left px-4 py-2 text-sm transition-colors border-b hover:bg-[#FAF6F0]"
                  style={{ borderColor: '#D4C5B0' }}
                >
                  <span className="font-bold" style={{ color: '#5C3D2E' }}>{v.word}</span>
                  <span className="block mt-0.5 truncate" style={{ color: '#7A6B5D' }}>{v.definition}</span>
                </button>
              ))
            )}
          </div>
        )}

        {tab === 'chats' && (
          <div className="py-1">
            {chats.length === 0 ? (
              <p className="px-4 py-3 text-sm" style={{ color: '#A89885' }}>
                No chats for this chapter. Highlight text and click "Ask about this" to start.
              </p>
            ) : (
              chats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => onOpenChat && onOpenChat(chat)}
                  className="w-full text-left px-4 py-2 text-sm transition-colors border-b hover:bg-[#FAF6F0]"
                  style={{ borderColor: '#D4C5B0' }}
                >
                  <span className="block truncate font-bold" style={{ color: '#5C3D2E' }}>{chat.title}</span>
                  <span className="block mt-0.5 text-xs" style={{ color: '#A89885' }}>
                    {chat.messages.length} messages &middot; {new Date(chat.updated_at).toLocaleDateString()}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
