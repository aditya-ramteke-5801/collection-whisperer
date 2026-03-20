import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import DefinitionPopup from './DefinitionPopup';
import SimplifyPopup from './SimplifyPopup';

export default function ReadingPane({ chapter, bookId, bookTitle, bookAuthor, chapterIndex, savedWords, onWordSaved, onScroll, onStartChat }) {
  const [popup, setPopup] = useState(null);
  const [simplifyPopup, setSimplifyPopup] = useState(null);
  const [defineBtn, setDefineBtn] = useState(null);
  const paneRef = useRef();
  const fontSize = useStore((s) => s.fontSize);
  const lineHeight = useStore((s) => s.lineHeight);
  const textWidth = useStore((s) => s.textWidth);
  const readingFont = useStore((s) => s.readingFont);

  useEffect(() => {
    let timeout;
    function handleSelectionChange() {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text) {
          setDefineBtn(null);
          return;
        }

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        if (paneRef.current && paneRef.current.contains(range.commonAncestorContainer)) {
          const wordCount = text.split(/\s+/).length;
          setDefineBtn({
            word: text,
            x: rect.left + rect.width / 2,
            y: rect.bottom,
            paragraph: getEnclosingParagraph(range.commonAncestorContainer),
            isLong: wordCount > 5,
          });
        }
      }, 300);
    }

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
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

  const handleScroll = useCallback((e) => {
    const el = e.target;
    const pct = el.scrollTop / (el.scrollHeight - el.clientHeight);
    if (onScroll) onScroll(pct);
  }, [onScroll]);

  function renderContent(text) {
    const paragraphs = text.split(/\n\n+/).filter(Boolean);
    return paragraphs.map((para, i) => {
      if (savedWords.length === 0) {
        return <p key={i} style={{ marginBottom: '1.2em' }}>{para}</p>;
      }

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

      return <p key={i} style={{ marginBottom: '1.2em' }}>{parts.length > 0 ? parts : para}</p>;
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
              left: defineBtn.x - 110,
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
          </div>
        ) : (
          <button
            onClick={handleDefine}
            className="fixed text-sm text-white px-3 py-1"
            style={{
              left: defineBtn.x - 30,
              top: defineBtn.y + 6,
              background: '#5C3D2E',
              zIndex: 999,
            }}
          >
            Define
          </button>
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
