import { Routes, Route } from 'react-router-dom';
import Library from './components/Library';
import Reader from './components/Reader';
import VocabBank from './components/VocabBank';
import SettingsModal from './components/SettingsModal';
import { useStore } from './store';

export default function App() {
  const settingsOpen = useStore((s) => s.settingsOpen);

  return (
    <>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/book/:bookId" element={<Reader />} />
        <Route path="/vocab" element={<VocabBank />} />
      </Routes>
      {settingsOpen && <SettingsModal />}
    </>
  );
}
