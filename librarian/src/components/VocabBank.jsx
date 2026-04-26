import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';
import { useStore } from '../store';
import PracticeMode from './PracticeMode';

export default function VocabBank() {
  const navigate = useNavigate();
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [vocab, setVocab] = useState([]);
  const [books, setBooks] = useState({});
  const [sortBy, setSortBy] = useState('created_at');
  const [filterBook, setFilterBook] = useState('all');
  const [filterMastery, setFilterMastery] = useState('all');
  const [practicing, setPracticing] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const allVocab = await db.vocabulary.toArray();
    const allBooks = await db.books.toArray();
    const bookMap = {};
    allBooks.forEach((b) => { bookMap[b.id] = b; });
    setVocab(allVocab);
    setBooks(bookMap);
  }

  const filtered = vocab
    .filter((v) => filterBook === 'all' || v.book_id === parseInt(filterBook))
    .filter((v) => filterMastery === 'all' || v.mastery === filterMastery)
    .sort((a, b) => {
      if (sortBy === 'created_at') return b.created_at - a.created_at;
      if (sortBy === 'word') return a.word.localeCompare(b.word);
      if (sortBy === 'mastery') return a.mastery.localeCompare(b.mastery);
      return 0;
    });

  const uniqueBooks = [...new Set(vocab.map((v) => v.book_id))];

  const masteryColors = {
    new: '#D4C5B0',
    learning: '#E8C86A',
    familiar: '#7DA07A',
    mastered: '#5C3D2E',
  };

  if (practicing) {
    return <PracticeMode vocab={vocab} onClose={() => { setPracticing(false); loadData(); }} />;
  }

  return (
    <div className="min-h-screen" style={{ background: '#FAF6F0' }}>
      <header
        className="flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
      >
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="text-sm px-2 py-1 border" style={{ borderColor: '#D4C5B0', background: '#FAF6F0', color: '#5C3D2E' }}>
            &larr; Back
          </button>
          <h1 className="text-base font-bold" style={{ color: '#5C3D2E' }}>Vocabulary Bank</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPracticing(true)}
            disabled={vocab.length === 0}
            className="text-sm px-3 py-1 text-white disabled:opacity-50"
            style={{ background: '#5C3D2E' }}
          >
            Practice
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-sm px-2 py-1 border"
            style={{ borderColor: '#D4C5B0', background: '#FAF6F0', color: '#5C3D2E' }}
          >
            &#9881;
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        <div className="flex flex-wrap gap-3 mb-4 text-sm">
          <div className="flex items-center gap-1">
            <span style={{ color: '#A89885' }}>Sort:</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="border px-2 py-1 outline-none" style={{ borderColor: '#D4C5B0', background: '#FAF6F0' }}>
              <option value="created_at">Date saved</option>
              <option value="word">Alphabetical</option>
              <option value="mastery">Mastery</option>
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span style={{ color: '#A89885' }}>Book:</span>
            <select value={filterBook} onChange={(e) => setFilterBook(e.target.value)} className="border px-2 py-1 outline-none" style={{ borderColor: '#D4C5B0', background: '#FAF6F0' }}>
              <option value="all">All books</option>
              {uniqueBooks.map((id) => (
                <option key={id} value={id}>{books[id]?.title || 'Unknown'}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span style={{ color: '#A89885' }}>Level:</span>
            <select value={filterMastery} onChange={(e) => setFilterMastery(e.target.value)} className="border px-2 py-1 outline-none" style={{ borderColor: '#D4C5B0', background: '#FAF6F0' }}>
              <option value="all">All levels</option>
              <option value="new">New</option>
              <option value="learning">Learning</option>
              <option value="familiar">Familiar</option>
              <option value="mastered">Mastered</option>
            </select>
          </div>
          <span style={{ color: '#A89885' }}>{filtered.length} words</span>
        </div>

        {filtered.length === 0 ? (
          <p className="text-sm py-8 text-center" style={{ color: '#A89885' }}>
            {vocab.length === 0 ? 'No words saved yet. Start reading and highlight words to build your vocabulary.' : 'No words match your filters.'}
          </p>
        ) : (
          <div className="border" style={{ borderColor: '#D4C5B0' }}>
            {filtered.map((v, i) => {
              const isExpanded = expandedId === v.id;
              return (
                <div
                  key={v.id}
                  style={{ borderBottom: i < filtered.length - 1 ? '1px solid #D4C5B0' : 'none' }}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-3 text-sm cursor-pointer"
                    style={{ background: isExpanded ? '#F3ECE0' : 'transparent' }}
                    onClick={() => setExpandedId(isExpanded ? null : v.id)}
                  >
                    <span
                      className="shrink-0 w-2 h-2 rounded-full"
                      style={{ background: masteryColors[v.mastery] }}
                    />
                    <span className="font-bold shrink-0" style={{ color: '#5C3D2E' }}>{v.word}</span>
                    <span className="text-xs shrink-0" style={{ color: '#A89885' }}>{v.pronunciation}</span>
                    <span className="text-xs shrink-0 italic" style={{ color: '#A89885' }}>{v.part_of_speech}</span>
                    <span className="flex-1" />
                    <span className="shrink-0 text-xs" style={{ color: '#A89885' }}>{books[v.book_id]?.title || ''}</span>
                    <span
                      className="shrink-0 px-2 py-0.5 text-[10px] uppercase font-bold"
                      style={{ background: masteryColors[v.mastery], color: v.mastery === 'mastered' ? '#FAF6F0' : '#3B2F2A' }}
                    >
                      {v.mastery}
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 text-sm" style={{ background: '#F3ECE0' }}>
                      <div className="mb-3">
                        <div className="font-bold text-[10px] uppercase mb-1" style={{ color: '#A89885', letterSpacing: '0.1em' }}>Meaning</div>
                        <p style={{ color: '#3B2F2A', lineHeight: 1.6 }}>{v.definition}</p>
                      </div>
                      <div className="mb-3">
                        <div className="font-bold text-[10px] uppercase mb-1" style={{ color: '#A89885', letterSpacing: '0.1em' }}>In Context</div>
                        <p style={{ color: '#3B2F2A', lineHeight: 1.6 }}>{v.context_meaning}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 text-xs" style={{ color: '#A89885' }}>
                          <span>Saved {new Date(v.created_at).toLocaleDateString()}</span>
                          <span>Chapter {v.chapter_index + 1}</span>
                        </div>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!window.confirm(`Delete "${v.word}" from vocabulary?`)) return;
                            await db.vocabulary.delete(v.id);
                            setExpandedId(null);
                            await loadData();
                          }}
                          className="text-xs px-2 py-1 border"
                          style={{ borderColor: '#C47A7A', background: '#F5E0E0', color: '#8B3A3A' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
