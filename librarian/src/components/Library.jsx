import { useState, useEffect } from 'react';
import { db } from '../db';
import { parsePdf } from '../utils/pdf-parser';
import { generateCoverImage } from '../api/openai';
import { useStore } from '../store';
import BookCard from './BookCard';
import UploadZone from './UploadZone';

export default function Library() {
  const [books, setBooks] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);
  const [error, setError] = useState('');
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const apiKey = useStore((s) => s.apiKey);

  useEffect(() => {
    loadBooks();
  }, []);

  async function loadBooks() {
    const all = await db.books.orderBy('last_read_at').reverse().toArray();
    setBooks(all);
  }

  async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are supported.');
      return;
    }

    const existing = await db.books.where('filename').equals(file.name).first();
    if (existing) {
      if (!window.confirm('A book with this name already exists. Replace it?')) return;
      await db.books.delete(existing.id);
      await db.vocabulary.where('book_id').equals(existing.id).delete();
    }

    setParsing(true);
    setError('');
    setParseProgress(0);

    try {
      const parsed = await parsePdf(file, setParseProgress);

      const bookId = await db.books.add({
        title: parsed.title,
        author: parsed.author,
        filename: file.name,
        file_type: 'pdf',
        chapters: parsed.chapters,
        current_chapter: 0,
        scroll_positions: {},
        time_spent_ms: 0,
        cover_image: null,
        created_at: Date.now(),
        last_read_at: Date.now(),
      });

      await loadBooks();

      // Generate cover image in background
      if (apiKey) {
        generateCoverImage({ title: parsed.title, author: parsed.author, apiKey })
          .then(async (dataUrl) => {
            await db.books.update(bookId, { cover_image: dataUrl });
            loadBooks();
          })
          .catch(() => {}); // silently fail — cover is optional
      }
    } catch (err) {
      setError(err.message || "Couldn't read this file. It may be corrupted or DRM-protected.");
    } finally {
      setParsing(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this book and all its vocabulary?')) return;
    await db.books.delete(id);
    await db.vocabulary.where('book_id').equals(id).delete();
    await loadBooks();
  }

  return (
    <div className="min-h-screen" style={{ background: '#FAF6F0' }}>
      <header
        className="flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
      >
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 210 40" width="158" height="30" xmlns="http://www.w3.org/2000/svg">
            <text x="0" y="32" fontFamily="'EB Garamond', Georgia, serif" fontSize="34" fontWeight="700" fill="#5C3D2E" letterSpacing="2">Gloss AI</text>
            <line x1="0" y1="38" x2="195" y2="38" stroke="#D4B88C" strokeWidth="1.2"/>
          </svg>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="text-sm px-3 py-1 border"
          style={{ background: '#FAF6F0', borderColor: '#D4C5B0', color: '#5C3D2E' }}
        >
          Settings
        </button>
      </header>

      <main className="max-w-3xl mx-auto p-6">
        {error && (
          <div className="mb-4 p-3 text-sm border" style={{ borderColor: '#C47A7A', background: '#F5E0E0', color: '#8B3A3A' }}>
            {error}
          </div>
        )}

        {parsing && (
          <div className="mb-4 p-3 text-sm border" style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}>
            <p>Parsing book... {parseProgress}%</p>
            <div className="mt-2 h-1 w-full" style={{ background: '#D4C5B0' }}>
              <div className="h-full transition-all" style={{ width: `${parseProgress}%`, background: '#5C3D2E' }} />
            </div>
          </div>
        )}

        {books.length === 0 && !parsing ? (
          <div className="mt-12">
            <UploadZone onFile={handleFile} />
          </div>
        ) : (
          <>
            <div className="mb-6">
              <UploadZone onFile={handleFile} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {books.map((book) => (
                <BookCard key={book.id} book={book} onDelete={handleDelete} onRename={loadBooks} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
