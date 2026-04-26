# Gloss AI

A local-first web app for reading English literature PDFs with AI-powered tools to help you understand what you're reading.

## Features

- **PDF Reader** — Upload PDFs, auto-detects chapters, front matter, and back matter. Clean paragraph formatting with page number removal.
- **Word Definitions** — Highlight a word to get its pronunciation, meaning, and what it means in context. Save words to your vocabulary bank.
- **Help Me Understand** — Highlight a passage to get it rewritten in simple English with dialogue properly formatted by speaker.
- **Chat with the Book** — Ask questions about any passage or chapter. Conversations are saved per-chapter so you can continue later.
- **Quiz Me** — Generate multiple-choice quizzes on selected chapters to test your comprehension.
- **Vocabulary Bank** — All saved words in one place with definitions, context, mastery levels, and spaced repetition practice.
- **Chapter Notes** — Write notes for each chapter. Must write at least 200 words before you can move to the next chapter. Notes tab in sidebar shows completion status per chapter.
- **Bookmarks** — Mark where you stopped reading. Progress shown as % completed based on word count.
- **Reading Preferences** — Multiple serif fonts, adjustable font size, line height, and text width.
- **Cover Images** — Auto-generated decorative SVG covers, with optional DALL-E generated covers.
- **API Usage Tracking** — See how much you've spent on OpenAI API calls, broken down by feature.
- **Data Management** — Export vocabulary as CSV, full backup as JSON, import from backup.

## Tech Stack

- React + Vite
- Zustand (state management)
- Dexie.js / IndexedDB (local storage)
- pdfjs-dist (PDF parsing)
- OpenAI API (gpt-4o / gpt-4o-mini / DALL-E 3)
- Tailwind CSS v4

## Setup

```bash
npm install
```

Create a `.env` file:

```
VITE_OPENAI_API_KEY=sk-your-key-here
```

Run the dev server:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

## Usage

1. Upload a PDF from the library screen
2. Start reading — highlight words to define them, highlight passages to simplify or chat about them
3. Use the bookmark button to mark where you stopped
4. Take quizzes to test your understanding
5. Review saved words in the Vocabulary Bank

## Project Structure

```
src/
  api/openai.js          — OpenAI API calls (definitions, quiz, simplify, chat, covers)
  components/
    Library.jsx           — Home screen with book grid
    Reader.jsx            — Main reading interface
    ReadingPane.jsx       — Text rendering with selection actions
    ChapterSidebar.jsx    — Chapter list, vocabulary, chats, and notes tabs
    NotesPanel.jsx        — Chapter notes modal with 200-word gate
    DefinitionPopup.jsx   — Word definition popup
    SimplifyPopup.jsx     — "Help me understand" modal
    ChatPanel.jsx         — Chapter-level chat interface
    QuizMode.jsx          — Quiz generation and taking
    VocabBank.jsx         — Vocabulary list with expand/delete
    PracticeMode.jsx      — Spaced repetition flashcards
    BookCard.jsx          — Book card with progress
    SettingsModal.jsx     — Settings, API usage, data management
    UploadZone.jsx        — Drag-and-drop PDF upload
    ProgressBar.jsx       — Reading progress bar
  utils/
    pdf-parser.js         — PDF text extraction with chapter detection
    cover-generator.js    — Deterministic SVG cover generation
    spaced-repetition.js  — SRS intervals for vocabulary practice
  db.js                   — Dexie database schema and helpers
  store.js                — Zustand store for settings
  App.jsx                 — Router setup
  main.jsx                — Entry point
```
