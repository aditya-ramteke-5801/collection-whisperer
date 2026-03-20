import { useState, useEffect, useRef } from 'react';
import { db } from '../db';
import { useStore } from '../store';
import { chatWithBook } from '../api/openai';

export default function ChatPanel({ bookId, bookTitle, bookAuthor, chapter, chapterIndex, initialText, onClose }) {
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState(initialText ? 'chat' : 'list'); // 'list' or 'chat'
  const messagesEndRef = useRef();
  const inputRef = useRef();
  const apiKey = useStore((s) => s.apiKey);
  const model = useStore((s) => s.model);

  useEffect(() => {
    loadChats();
  }, [bookId, chapterIndex]);

  useEffect(() => {
    if (initialText && view === 'chat' && !activeChat) {
      startNewChat(initialText);
    }
  }, [initialText]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (view === 'chat') inputRef.current?.focus();
  }, [view, activeChat]);

  async function loadChats() {
    const all = await db.chats
      .where('book_id').equals(bookId)
      .and((c) => c.chapter_index === chapterIndex)
      .reverse()
      .sortBy('updated_at');
    setChats(all);
  }

  async function startNewChat(contextText) {
    const snippet = contextText
      ? (contextText.length > 500 ? contextText.slice(0, 500) + '...' : contextText)
      : '';

    const chatId = await db.chats.add({
      book_id: bookId,
      chapter_index: chapterIndex,
      title: contextText ? contextText.slice(0, 60).replace(/\n/g, ' ') + '...' : 'New chat',
      context_snippet: snippet,
      messages: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    });

    const chat = await db.chats.get(chatId);
    setActiveChat(chat);
    setMessages([]);
    setView('chat');
  }

  async function openChat(chat) {
    setActiveChat(chat);
    setMessages(chat.messages);
    setView('chat');
  }

  async function sendMessage(text) {
    if (!text.trim() || !activeChat) return;

    const userMsg = { role: 'user', content: text.trim() };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      // If there's a context snippet and this is the first message,
      // prepend it to the API messages so the AI knows what passage is being discussed
      let apiMessages = updatedMessages;
      if (activeChat.context_snippet && updatedMessages.length === 1) {
        apiMessages = [{
          role: 'user',
          content: `Regarding this passage:\n"${activeChat.context_snippet}"\n\n${text.trim()}`,
        }];
      }

      const reply = await chatWithBook({
        messages: apiMessages,
        chapterText: chapter.content,
        bookTitle,
        bookAuthor,
        chapterTitle: chapter.title,
        apiKey,
        model,
      });

      const assistantMsg = { role: 'assistant', content: reply };
      const allMessages = [...updatedMessages, assistantMsg];
      setMessages(allMessages);

      // Update title from first user question
      const updates = { messages: allMessages, updated_at: Date.now() };
      if (messages.length === 0) {
        updates.title = text.trim().slice(0, 60);
        if (updates.title.length >= 60) updates.title += '...';
      }

      await db.chats.update(activeChat.id, updates);
      setActiveChat({ ...activeChat, ...updates });
      await loadChats();
    } catch (err) {
      const errMsg = { role: 'assistant', content: `Error: ${err.message}` };
      setMessages([...updatedMessages, errMsg]);
    } finally {
      setLoading(false);
    }
  }

  async function deleteChat(chatId, e) {
    e.stopPropagation();
    await db.chats.delete(chatId);
    if (activeChat?.id === chatId) {
      setActiveChat(null);
      setMessages([]);
      setView('list');
    }
    await loadChats();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center"
      style={{ background: 'rgba(59,47,42,0.3)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-2xl border flex flex-col"
        style={{
          background: '#FAF6F0',
          borderColor: '#D4C5B0',
          boxShadow: '0 8px 24px rgba(59,47,42,0.15)',
          height: '80vh',
        }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
        >
          <div className="flex items-center gap-2">
            {view === 'chat' && (
              <button
                onClick={() => { setView('list'); setActiveChat(null); setMessages([]); }}
                className="text-sm px-2 py-1 border"
                style={{ borderColor: '#D4C5B0', background: '#FAF6F0', color: '#5C3D2E' }}
              >
                &larr;
              </button>
            )}
            <h2 className="text-sm font-bold" style={{ color: '#5C3D2E' }}>
              {view === 'list' ? `Chats — ${chapter.title}` : (activeChat?.title || 'Chat')}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {view === 'list' && (
              <button
                onClick={() => startNewChat('')}
                className="text-sm px-3 py-1 text-white"
                style={{ background: '#5C3D2E' }}
              >
                New Chat
              </button>
            )}
            <button
              onClick={onClose}
              className="text-sm px-2 py-1 border"
              style={{ borderColor: '#D4C5B0' }}
            >
              x
            </button>
          </div>
        </div>

        {view === 'list' ? (
          /* Chat List */
          <div className="flex-1 overflow-y-auto">
            {chats.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-sm" style={{ color: '#A89885' }}>
                <p>No chats for this chapter yet.</p>
                <p className="mt-1">Highlight text and click "Ask about this" to start, or click "New Chat".</p>
              </div>
            ) : (
              chats.map((chat) => (
                <div
                  key={chat.id}
                  onClick={() => openChat(chat)}
                  className="flex items-center gap-3 px-4 py-3 border-b cursor-pointer hover:bg-[#F3ECE0] transition-colors"
                  style={{ borderColor: '#D4C5B0' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate" style={{ color: '#5C3D2E' }}>
                      {chat.title}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: '#A89885' }}>
                      {chat.messages.length} messages &middot; {new Date(chat.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    onClick={(e) => deleteChat(chat.id, e)}
                    className="shrink-0 text-xs px-2 py-1 border"
                    style={{ borderColor: '#D4C5B0', color: '#8B3A3A' }}
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          /* Chat View */
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {/* Show context snippet if present */}
              {activeChat?.context_snippet && (
                <div className="p-3 border text-sm italic" style={{ borderColor: '#D4C5B0', background: '#F3ECE0', color: '#5C3D2E', lineHeight: 1.6 }}>
                  <div className="font-bold text-[10px] uppercase mb-1 not-italic" style={{ color: '#A89885', letterSpacing: '0.1em' }}>Discussing this passage</div>
                  "{activeChat.context_snippet}"
                </div>
              )}
              {messages.length === 0 && !loading && (
                <p className="text-sm text-center py-4" style={{ color: '#A89885' }}>
                  Ask any question about {activeChat?.context_snippet ? 'this passage' : 'this chapter'}...
                </p>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[80%] px-4 py-3 text-sm"
                    style={{
                      background: msg.role === 'user' ? '#5C3D2E' : '#F3ECE0',
                      color: msg.role === 'user' ? '#FAF6F0' : '#3B2F2A',
                      borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div
                    className="px-4 py-3 text-sm"
                    style={{ background: '#F3ECE0', borderRadius: '12px 12px 12px 2px' }}
                  >
                    <div className="flex gap-1">
                      <span className="shimmer w-2 h-2 rounded-full inline-block" />
                      <span className="shimmer w-2 h-2 rounded-full inline-block" style={{ animationDelay: '0.2s' }} />
                      <span className="shimmer w-2 h-2 rounded-full inline-block" style={{ animationDelay: '0.4s' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t px-4 py-3" style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}>
              {!apiKey ? (
                <p className="text-sm" style={{ color: '#8B3A3A' }}>No API key set. Open Settings to add your OpenAI API key.</p>
              ) : (
                <div className="flex gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={activeChat?.context_snippet ? "Ask about this passage..." : "Ask about this chapter..."}
                    rows={1}
                    className="flex-1 text-sm px-3 py-2 border outline-none resize-none"
                    style={{ borderColor: '#D4C5B0', background: '#FAF6F0' }}
                    disabled={loading}
                  />
                  <button
                    onClick={() => sendMessage(input)}
                    disabled={loading || !input.trim()}
                    className="text-sm px-4 py-2 text-white disabled:opacity-50"
                    style={{ background: '#5C3D2E' }}
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
