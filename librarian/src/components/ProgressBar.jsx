function formatTime(ms) {
  if (!ms || ms < 60000) return '< 1m';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export default function ProgressBar({ currentChapter, totalChapters, scrollPercent, timeSpent }) {
  const overallProgress = totalChapters > 0
    ? Math.round(((currentChapter + scrollPercent) / totalChapters) * 100)
    : 0;

  return (
    <footer
      className="shrink-0 border-t"
      style={{ borderColor: '#D4C5B0', background: '#F3ECE0' }}
    >
      <div className="h-0.5 w-full" style={{ background: '#D4C5B0' }}>
        <div
          className="h-full transition-all"
          style={{ width: `${overallProgress}%`, background: '#5C3D2E' }}
        />
      </div>
      <div className="flex justify-between px-4 py-1 text-sm" style={{ color: '#A89885' }}>
        <span>{formatTime(timeSpent)} read</span>
        <span>Chapter {currentChapter + 1} of {totalChapters}</span>
      </div>
    </footer>
  );
}
