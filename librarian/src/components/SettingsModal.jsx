import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { testApiKey } from '../api/openai';
import { db, getUsageStats } from '../db';

export default function SettingsModal() {
  const {
    apiKey, setApiKey,
    model, setModel,
    fontSize, setFontSize,
    lineHeight, setLineHeight,
    textWidth, setTextWidth,
    setSettingsOpen,
  } = useStore();

  const [keyInput, setKeyInput] = useState(apiKey);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    getUsageStats().then(setUsage);
  }, []);

  async function handleTest() {
    setTesting(true);
    setTestResult('');
    try {
      await testApiKey(keyInput);
      setTestResult('success');
      setApiKey(keyInput);
    } catch (err) {
      setTestResult(err.message);
    } finally {
      setTesting(false);
    }
  }

  function handleSaveKey() {
    setApiKey(keyInput);
    setTestResult('');
  }

  async function handleExportVocab() {
    const vocab = await db.vocabulary.toArray();
    const books = await db.books.toArray();
    const bookMap = {};
    books.forEach((b) => { bookMap[b.id] = b.title; });

    const csv = [
      'Word,Pronunciation,Part of Speech,Definition,Context,Book,Chapter,Mastery,Date Saved',
      ...vocab.map((v) =>
        [v.word, v.pronunciation, v.part_of_speech, `"${v.definition}"`, `"${v.context_meaning}"`, `"${bookMap[v.book_id] || ''}"`, v.chapter_index, v.mastery, new Date(v.created_at).toISOString()].join(',')
      ),
    ].join('\n');

    downloadFile(csv, 'gloss-vocabulary.csv', 'text/csv');
  }

  async function handleExportAll() {
    const data = {
      books: await db.books.toArray(),
      vocabulary: await db.vocabulary.toArray(),
    };
    downloadFile(JSON.stringify(data, null, 2), 'gloss-backup.json', 'application/json');
  }

  async function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.books) {
          await db.books.clear();
          await db.books.bulkAdd(data.books);
        }
        if (data.vocabulary) {
          await db.vocabulary.clear();
          await db.vocabulary.bulkAdd(data.vocabulary);
        }
        alert('Data imported successfully.');
      } catch {
        alert('Failed to import data. Invalid file.');
      }
    };
    input.click();
  }

  async function handleClearAll() {
    if (!window.confirm('Are you sure? This will delete all books and vocabulary. This cannot be undone.')) return;
    await db.books.clear();
    await db.vocabulary.clear();
    localStorage.removeItem('librarian_api_key');
    setApiKey('');
    alert('All data cleared.');
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center"
      style={{ background: 'rgba(59,47,42,0.3)' }}
      onClick={(e) => { if (e.target === e.currentTarget) setSettingsOpen(false); }}
    >
      <div className="w-full max-w-md border p-6" style={{ background: '#FAF6F0', borderColor: '#D4C5B0' }}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-base font-bold" style={{ color: '#5C3D2E' }}>Settings</h2>
          <button onClick={() => setSettingsOpen(false)} className="text-sm px-2 py-1 border" style={{ borderColor: '#D4C5B0' }}>
            x
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-bold mb-1">OpenAI API Key</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              className="flex-1 text-sm px-2 py-1.5 border outline-none"
              style={{ borderColor: '#D4C5B0', background: '#FAF6F0' }}
              placeholder="sk-..."
            />
            <button
              onClick={handleSaveKey}
              className="text-sm px-3 py-1 border"
              style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
            >
              Save
            </button>
            <button
              onClick={handleTest}
              disabled={testing || !keyInput}
              className="text-sm px-3 py-1 text-white disabled:opacity-50"
              style={{ background: '#5C3D2E' }}
            >
              {testing ? '...' : 'Test'}
            </button>
          </div>
          {testResult === 'success' && (
            <p className="text-sm mt-1" style={{ color: '#4A6741' }}>API key is valid.</p>
          )}
          {testResult && testResult !== 'success' && (
            <p className="text-sm mt-1" style={{ color: '#8B3A3A' }}>{testResult}</p>
          )}
        </div>

        <div className="mb-4">
          <label className="block text-sm font-bold mb-1">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-sm px-2 py-1.5 border w-full outline-none"
            style={{ borderColor: '#D4C5B0', background: '#FAF6F0' }}
          >
            <option value="gpt-4o">gpt-4o (recommended)</option>
            <option value="gpt-4o-mini">gpt-4o-mini (cheaper)</option>
          </select>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-bold mb-2">Reading Preferences</label>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Font size: {fontSize}px</span>
              <input type="range" min="14" max="24" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-32" />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Line height: {lineHeight}</span>
              <input type="range" min="1.4" max="2.2" step="0.1" value={lineHeight} onChange={(e) => setLineHeight(parseFloat(e.target.value))} className="w-32" />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Text width: {textWidth}px</span>
              <input type="range" min="500" max="800" step="20" value={textWidth} onChange={(e) => setTextWidth(parseInt(e.target.value))} className="w-32" />
            </div>
          </div>
        </div>

        {/* API Usage */}
        <div className="mb-4">
          <label className="block text-sm font-bold mb-2">API Usage & Cost</label>
          {usage ? (
            <div className="border p-3" style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}>
              <div className="flex justify-between text-sm mb-2">
                <span>Total spent</span>
                <span className="font-bold" style={{ color: '#5C3D2E' }}>${usage.totalCost.toFixed(4)}</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span style={{ color: '#7A6B5D' }}>API calls</span>
                <span>{usage.totalCalls}</span>
              </div>
              <div className="flex justify-between text-sm mb-1">
                <span style={{ color: '#7A6B5D' }}>Tokens (in / out)</span>
                <span>{usage.totalPromptTokens.toLocaleString()} / {usage.totalCompletionTokens.toLocaleString()}</span>
              </div>
              {Object.keys(usage.byFeature).length > 0 && (
                <div className="mt-2 pt-2 border-t" style={{ borderColor: '#D4C5B0' }}>
                  {Object.entries(usage.byFeature).map(([feature, data]) => (
                    <div key={feature} className="flex justify-between text-sm" style={{ color: '#7A6B5D' }}>
                      <span>{feature}</span>
                      <span>{data.calls} calls · ${data.cost.toFixed(4)}</span>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={async () => {
                  if (window.confirm('Reset API usage count? This cannot be undone.')) {
                    await db.api_usage.clear();
                    setUsage({ totalCost: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCalls: 0, byFeature: {} });
                  }
                }}
                className="mt-2 text-sm px-3 py-1 border"
                style={{ borderColor: '#C47A7A', background: '#F5E0E0', color: '#8B3A3A' }}
              >
                Reset Usage
              </button>
            </div>
          ) : (
            <p className="text-sm" style={{ color: '#A89885' }}>Loading...</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-bold mb-2">Data Management</label>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleExportVocab} className="text-sm px-3 py-1 border" style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}>
              Export Vocab CSV
            </button>
            <button onClick={handleExportAll} className="text-sm px-3 py-1 border" style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}>
              Export All JSON
            </button>
            <button onClick={handleImport} className="text-sm px-3 py-1 border" style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}>
              Import JSON
            </button>
            <button onClick={handleClearAll} className="text-sm px-3 py-1 border" style={{ borderColor: '#C47A7A', background: '#F5E0E0', color: '#8B3A3A' }}>
              Clear All Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
