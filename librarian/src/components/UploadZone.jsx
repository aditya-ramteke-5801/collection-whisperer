import { useState, useRef } from 'react';

export default function UploadZone({ onFile }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }

  function handleChange(e) {
    const file = e.target.files[0];
    if (file) onFile(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current.click()}
      className="cursor-pointer border-2 border-dashed p-12 text-center transition-colors"
      style={{
        borderColor: dragging ? '#5C3D2E' : '#D4C5B0',
        background: dragging ? '#EDE4D4' : '#F3ECE0',
      }}
    >
      <p className="text-sm" style={{ color: '#7A6B5D' }}>
        Drop a PDF file here to start reading
      </p>
      <p className="text-xs mt-2" style={{ color: '#A89885' }}>
        or click to browse
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        onChange={handleChange}
        className="hidden"
      />
    </div>
  );
}
