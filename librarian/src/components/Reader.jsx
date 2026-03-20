import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../db';
import { useStore } from '../store';
import ChapterSidebar from './ChapterSidebar';
import ReadingPane from './ReadingPane';
import ProgressBar from './ProgressBar';
import QuizMode from './QuizMode';
import ChatPanel from './ChatPanel';

export default function Reader() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [currentChapter, setCurrentChapter] = useState(0);
  const [vocabWords, setVocabWords] = useState([]);
  const [savedWordList, setSavedWordList] = useState([]);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [quizOpen, setQuizOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInitialText, setChatInitialText] = useState('');

  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const toggleSidebar = useStore((s) => s.toggleSidebar);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const readingFont = useStore((s) => s.readingFont);
  const setReadingFont = useStore((s) => s.setReadingFont);

  // Time tracking
  const sessionStartRef = useRef(Date.now());

  useEffect(() => {
    sessionStartRef.current = Date.now();

    // Save time on unmount, visibility change, or beforeunload
    function saveTime() {
      const elapsed = Date.now() - sessionStartRef.current;
      if (elapsed > 1000 && bookId) {
        // Use sync-safe approach: update DB directly
        db.books.get(parseInt(bookId)).then((b) => {
          if (b) {
            db.books.update(b.id, { time_spent_ms: (b.time_spent_ms || 0) + elapsed });
          }
        });
      }
      sessionStartRef.current = Date.now();
    }

    function handleVisibility() {
      if (document.hidden) saveTime();
      else sessionStartRef.current = Date.now();
    }

    window.addEventListener('beforeunload', saveTime);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      saveTime();
      window.removeEventListener('beforeunload', saveTime);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [bookId]);

  useEffect(() => {
    loadBook();
  }, [bookId]);

  useEffect(() => {
    if (book) loadVocab();
  }, [book, currentChapter]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'ArrowLeft') prevChapter();
      if (e.key === 'ArrowRight') nextChapter();
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [book, currentChapter]);

  async function loadBook() {
    const b = await db.books.get(parseInt(bookId));
    if (!b) { navigate('/'); return; }
    setBook(b);
    setCurrentChapter(b.current_chapter || 0);
    await db.books.update(b.id, { last_read_at: Date.now() });
  }

  async function loadVocab() {
    const words = await db.vocabulary.where('book_id').equals(book.id).toArray();
    setVocabWords(words);
    setSavedWordList(words.map((w) => w.word));
  }

  async function changeChapter(idx) {
    if (!book || idx < 0 || idx >= book.chapters.length) return;
    setCurrentChapter(idx);
    setScrollPercent(0);
    await db.books.update(book.id, { current_chapter: idx });
  }

  function prevChapter() { changeChapter(currentChapter - 1); }
  function nextChapter() { changeChapter(currentChapter + 1); }

  const handleScroll = useCallback(async (pct) => {
    setScrollPercent(pct);
    if (book) {
      const positions = { ...(book.scroll_positions || {}), [currentChapter]: pct };
      await db.books.update(book.id, { scroll_positions: positions });
    }
  }, [book, currentChapter]);

  async function handleWordSaved(word) {
    await loadVocab();
  }

  function handleStartChat(text) {
    setChatInitialText(text || '');
    setChatOpen(true);
  }

  function handleVocabClick(vocab) {
    if (vocab.chapter_index !== currentChapter) {
      changeChapter(vocab.chapter_index);
    }
  }

  if (!book) {
    return <div className="flex items-center justify-center min-h-screen text-sm" style={{ color: '#A89885' }}>Loading...</div>;
  }

  const chapter = book.chapters[currentChapter];

  return (
    <div className="flex flex-col h-screen" style={{ background: '#FAF6F0' }}>
      {/* Topbar */}
      <header
        className="shrink-0 flex items-center justify-between px-4 py-2 border-b"
        style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
      >
        <div className="flex items-center gap-3">
          <button onClick={toggleSidebar} className="text-sm px-2 py-1 border" style={{ borderColor: '#D4C5B0', background: '#FAF6F0', color: '#5C3D2E' }}>
            &#9776;
          </button>
          <button onClick={() => navigate('/')} className="text-sm px-2 py-1 border" style={{ borderColor: '#D4C5B0', background: '#FAF6F0', color: '#5C3D2E' }}>
            &larr;
          </button>
        </div>

        <div className="text-sm text-center truncate flex-1 mx-4">
          <span className="font-bold" style={{ color: '#5C3D2E' }}>{book.title}</span>
          {chapter && <span style={{ color: '#A89885' }}> &middot; {chapter.title}</span>}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={readingFont}
            onChange={(e) => setReadingFont(e.target.value)}
            className="text-sm px-2 py-1 border outline-none"
            style={{ borderColor: '#D4C5B0', background: '#FAF6F0', color: '#5C3D2E' }}
          >
            <option value="EB Garamond">EB Garamond</option>
            <option value="Cormorant Garamond">Cormorant Garamond</option>
            <option value="Literata">Literata</option>
            <option value="Lora">Lora</option>
            <option value="Merriweather">Merriweather</option>
            <option value="Crimson Text">Crimson Text</option>
            <option value="Source Serif 4">Source Serif 4</option>
          </select>
          <button
            onClick={() => handleStartChat('')}
            className="text-sm px-3 py-1 text-white"
            style={{ background: '#5C3D2E' }}
          >
            Chat
          </button>
          <button
            onClick={() => setQuizOpen(true)}
            className="text-sm px-3 py-1 text-white"
            style={{ background: '#5C3D2E' }}
          >
            Quiz
          </button>
          <button
            onClick={() => navigate('/vocab')}
            className="text-sm px-2 py-1 border relative"
            style={{ borderColor: '#D4C5B0', background: '#FAF6F0', color: '#5C3D2E' }}
          >
            Vocab
            {vocabWords.length > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 text-white text-[10px] px-1 rounded-full"
                style={{ background: '#5C3D2E', minWidth: 16, textAlign: 'center' }}
              >
                {vocabWords.length}
              </span>
            )}
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

      <div className="flex flex-1 overflow-hidden">
        <ChapterSidebar
          chapters={book.chapters}
          currentChapter={currentChapter}
          vocabWords={vocabWords}
          onChapterSelect={changeChapter}
          onVocabClick={handleVocabClick}
          onOpenChat={() => handleStartChat('')}
          open={sidebarOpen}
          bookId={book.id}
        />
        {chapter ? (
          <ReadingPane
            chapter={chapter}
            bookId={book.id}
            bookTitle={book.title}
            bookAuthor={book.author}
            chapterIndex={currentChapter}
            savedWords={savedWordList}
            onWordSaved={handleWordSaved}
            onScroll={handleScroll}
            onStartChat={handleStartChat}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm" style={{ color: '#A89885' }}>
            No content
          </div>
        )}
      </div>

      <ProgressBar
        currentChapter={currentChapter}
        totalChapters={book.chapters.length}
        scrollPercent={scrollPercent}
        timeSpent={book.time_spent_ms}
      />

      {quizOpen && <QuizMode book={book} onClose={() => setQuizOpen(false)} />}

      {chatOpen && (
        <ChatPanel
          bookId={book.id}
          bookTitle={book.title}
          bookAuthor={book.author}
          chapter={chapter}
          chapterIndex={currentChapter}
          initialText={chatInitialText}
          onClose={() => { setChatOpen(false); setChatInitialText(''); }}
        />
      )}
    </div>
  );
}
