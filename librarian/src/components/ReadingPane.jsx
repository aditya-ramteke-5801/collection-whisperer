import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import { db } from '../db';
import DefinitionPopup from './DefinitionPopup';
import SimplifyPopup from './SimplifyPopup';

export default function ReadingPane({ chapter, bookId, bookTitle, bookAuthor, chapterIndex, savedWords, onWordSaved, onScroll, onStartChat, bookmark, onBookmarkSet }) {
  const [popup, setPopup] = useState(null);
  const [simplifyPopup, setSimplifyPopup] = useState(null);
  const [defineBtn, setDefineBtn] = useState(null);
  const paneRef = useRef();
  const bookmarkRef = useRef();
  const fontSize = useStore((s) => s.fontSize);
  const lineHeight = useStore((s) => s.lineHeight);
  const textWidth = useStore((s) => s.textWidth);
  const readingFont = useStore((s) => s.readingFont);

  useEffect(() => {
    function checkSelection() {
      const selection = window.getSelection();
      const text = selection?.toString().trim();
      if (!text) {
        setDefineBtn(null);
        return;
      }

      if (!selection.rangeCount) return;
      const range = selection.getRangeAt(0);

      // Check if selection is inside the reading pane
      const ancestor = range.commonAncestorContainer;
      if (!paneRef.current || !paneRef.current.contains(ancestor)) return;

      // Use the end of the selection for button position — get the last
      // client rect which is the visible end point of the selection
      const rects = range.getClientRects();
      if (!rects.length) return;
      const lastRect = rects[rects.length - 1];

      // Clamp position to be within viewport
      const paneRect = paneRef.current.getBoundingClientRect();
      const y = Math.min(lastRect.bottom, paneRect.bottom - 10);
      const x = lastRect.left + lastRect.width / 2;

      const wordCount = text.split(/\s+/).length;
      setDefineBtn({
        word: text,
        x,
        y,
        paragraph: getEnclosingParagraph(ancestor),
        isLong: wordCount > 5,
      });
    }

    // Show buttons on mouseup (after drag-select finishes)
    function handleMouseUp() {
      // Small delay to let the selection finalize
      setTimeout(checkSelection, 50);
    }

    // Also handle selectionchange for keyboard/touch selections,
    // but debounce it
    let timeout;
    function handleSelectionChange() {
      clearTimeout(timeout);
      timeout = setTimeout(checkSelection, 400);
    }

    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('selectionchange', handleSelectionChange);
      clearTimeout(timeout);
    };
  }, []);

  function getEnclosingParagraph(node) {
    let el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el.tagName !== 'P' && el !== paneRef.current) {
      el = el.parentElement;
    }
    return el?.textContent || '';
  }

  function handleDefine() {
    if (!defineBtn) return;
    setPopup({
      word: defineBtn.word,
      paragraph: defineBtn.paragraph,
      position: { x: defineBtn.x - 170, y: defineBtn.y },
    });
    setDefineBtn(null);
    window.getSelection()?.removeAllRanges();
  }

  function handleSimplify() {
    if (!defineBtn) return;
    setSimplifyPopup({ text: defineBtn.word });
    setDefineBtn(null);
    window.getSelection()?.removeAllRanges();
  }

  function handleAsk() {
    if (!defineBtn) return;
    const text = defineBtn.word;
    setDefineBtn(null);
    window.getSelection()?.removeAllRanges();
    if (onStartChat) onStartChat(text);
  }

  function handleBookmark() {
    if (!defineBtn) return;
    // Find which paragraph the selection ends in
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    let el = range.endContainer;
    if (el.nodeType === 3) el = el.parentElement;
    while (el && el.tagName !== 'P' && el !== paneRef.current) {
      el = el.parentElement;
    }
    if (el && el.tagName === 'P' && el.dataset.paraIndex !== undefined) {
      const paraIndex = parseInt(el.dataset.paraIndex);
      // dataset converts data-para-index to paraIndex automatically
      if (onBookmarkSet) onBookmarkSet(chapterIndex, paraIndex);
    }
    setDefineBtn(null);
    window.getSelection()?.removeAllRanges();
  }

  // Scroll to bookmark on chapter load
  useEffect(() => {
    if (bookmark !== null && bookmark !== undefined && bookmarkRef.current) {
      setTimeout(() => {
        bookmarkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [chapterIndex]);

  const handleScroll = useCallback((e) => {
    const el = e.target;
    const pct = el.scrollTop / (el.scrollHeight - el.clientHeight);
    if (onScroll) onScroll(pct);
  }, [onScroll]);

  function renderContent(text) {
    const paragraphs = text.split(/\n\n+/).filter(Boolean);
    return paragraphs.map((para, i) => {
      const isBookmarked = bookmark === i;
      const paraContent = (() => {
        if (savedWords.length === 0) return para;

        const regex = new RegExp(`\\b(${savedWords.map(escapeRegex).join('|')})\\b`, 'gi');
        const parts = [];
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(para)) !== null) {
          if (match.index > lastIndex) {
            parts.push(para.slice(lastIndex, match.index));
          }
          parts.push(
            <mark
              key={`${i}-${match.index}`}
              style={{ background: '#F5E6C8', borderBottom: '1px solid #D4B88C', padding: '0 1px', cursor: 'pointer' }}
            >
              {match[0]}
            </mark>
          );
          lastIndex = regex.lastIndex;
        }
        if (lastIndex < para.length) {
          parts.push(para.slice(lastIndex));
        }

        return parts.length > 0 ? parts : para;
      })();

      return (
        <div key={i} style={{ position: 'relative' }}>
          <p
            data-para-index={i}
            ref={isBookmarked ? bookmarkRef : undefined}
            style={{ marginBottom: '1.2em' }}
          >
            {paraContent}
          </p>
          {isBookmarked && (
            <div
              style={{
                borderTop: '2px dashed #D4B88C',
                marginBottom: '1.2em',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                paddingTop: 4,
              }}
            >
              <span style={{ fontSize: 11, color: '#A89885', whiteSpace: 'nowrap' }}>
                &#x1F516; I read till here
              </span>
              <button
                onClick={() => onBookmarkSet && onBookmarkSet(chapterIndex, null)}
                style={{ fontSize: 10, color: '#A89885', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
              >
                (clear)
              </button>
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <div
      ref={paneRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-6 py-8"
      style={{ background: '#FAF6F0' }}
    >
      <div
        className="mx-auto"
        style={{
          maxWidth: textWidth,
          fontFamily: `'${readingFont}', serif`,
          fontSize,
          lineHeight,
          color: '#3B2F2A',
          textAlign: 'justify',
          hyphens: 'auto',
        }}
      >
        <h2
          className="font-bold mb-6 pb-3 border-b"
          style={{ fontSize: fontSize * 1.4, borderColor: '#D4C5B0', color: '#5C3D2E' }}
        >
          {chapter.title}
        </h2>

        <div className="reading-content">
          {renderContent(chapter.content)}
        </div>
      </div>

      {defineBtn && !popup && !simplifyPopup && (
        defineBtn.isLong ? (
          <div
            className="fixed flex gap-1"
            style={{
              left: defineBtn.x - 140,
              top: defineBtn.y + 6,
              zIndex: 999,
            }}
          >
            <button
              onClick={handleSimplify}
              className="text-sm text-white px-3 py-1"
              style={{ background: '#5C3D2E' }}
            >
              Help me understand
            </button>
            <button
              onClick={handleAsk}
              className="text-sm px-3 py-1 border"
              style={{ background: '#F3ECE0', borderColor: '#D4C5B0', color: '#5C3D2E' }}
            >
              Ask about this
            </button>
            <button
              onClick={handleBookmark}
              className="text-sm px-3 py-1 border"
              style={{ background: '#F3ECE0', borderColor: '#D4C5B0', color: '#5C3D2E' }}
            >
              &#x1F516;
            </button>
          </div>
        ) : (
          <div
            className="fixed flex gap-1"
            style={{
              left: defineBtn.x - 50,
              top: defineBtn.y + 6,
              zIndex: 999,
            }}
          >
            <button
              onClick={handleDefine}
              className="text-sm text-white px-3 py-1"
              style={{ background: '#5C3D2E' }}
            >
              Define
            </button>
            <button
              onClick={handleBookmark}
              className="text-sm px-3 py-1 border"
              style={{ background: '#F3ECE0', borderColor: '#D4C5B0', color: '#5C3D2E' }}
            >
              &#x1F516;
            </button>
          </div>
        )
      )}

      {popup && (
        <DefinitionPopup
          word={popup.word}
          paragraph={popup.paragraph}
          bookId={bookId}
          bookTitle={bookTitle}
          bookAuthor={bookAuthor}
          chapterTitle={chapter.title}
          chapterIndex={chapterIndex}
          position={popup.position}
          onClose={() => setPopup(null)}
          onSaved={onWordSaved}
        />
      )}

      {simplifyPopup && (
        <SimplifyPopup
          text={simplifyPopup.text}
          bookTitle={bookTitle}
          bookAuthor={bookAuthor}
          chapterTitle={chapter.title}
          onClose={() => setSimplifyPopup(null)}
        />
      )}
    </div>
  );
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
