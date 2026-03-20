import { create } from 'zustand';

export const useStore = create((set) => ({
  // Settings
  apiKey: import.meta.env.VITE_OPENAI_API_KEY || localStorage.getItem('librarian_api_key') || '',
  model: localStorage.getItem('librarian_model') || 'gpt-4o',
  fontSize: parseInt(localStorage.getItem('librarian_font_size')) || 18,
  lineHeight: parseFloat(localStorage.getItem('librarian_line_height')) || 1.8,
  textWidth: parseInt(localStorage.getItem('librarian_text_width')) || 680,
  readingFont: localStorage.getItem('librarian_reading_font') || 'EB Garamond',

  setApiKey: (key) => {
    localStorage.setItem('librarian_api_key', key);
    set({ apiKey: key });
  },
  setModel: (model) => {
    localStorage.setItem('librarian_model', model);
    set({ model });
  },
  setFontSize: (size) => {
    localStorage.setItem('librarian_font_size', size);
    set({ fontSize: size });
  },
  setLineHeight: (height) => {
    localStorage.setItem('librarian_line_height', height);
    set({ lineHeight: height });
  },
  setTextWidth: (width) => {
    localStorage.setItem('librarian_text_width', width);
    set({ textWidth: width });
  },
  setReadingFont: (font) => {
    localStorage.setItem('librarian_reading_font', font);
    set({ readingFont: font });
  },

  // Settings modal
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  // Sidebar
  sidebarOpen: window.innerWidth > 1024,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
