import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

const CHAPTER_PATTERNS = [
  /^chapter\s+\d+/i,
  /^chapter\s+[a-z]+/i,
  /^part\s+\d+/i,
  /^part\s+[a-z]+/i,
  /^book\s+\d+/i,
  /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX|XXI|XXII|XXIII|XXIV|XXV)\s*$/,
  /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX)\./,
  /^\d+\.\s/,
];

function isChapterHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return CHAPTER_PATTERNS.some((p) => p.test(trimmed));
}

/**
 * Extract structured text from a PDF page using text item positions.
 * Groups items into lines by Y-coordinate, then detects paragraph breaks
 * when the vertical gap between lines exceeds the typical line spacing.
 */
async function extractPageText(page) {
  const content = await page.getTextContent();
  const items = content.items.filter((item) => item.str.trim().length > 0);

  if (items.length === 0) return '';

  const lineMap = new Map();
  const Y_TOLERANCE = 3;

  // Get page dimensions to identify header/footer zones
  const viewport = page.getViewport({ scale: 1 });
  const pageHeight = viewport.height;
  const headerZone = pageHeight * 0.9;  // top 10% (Y is from bottom in PDF coords)
  const footerZone = pageHeight * 0.1;  // bottom 10%

  for (const item of items) {
    const y = Math.round(item.transform[5] / Y_TOLERANCE) * Y_TOLERANCE;
    const x = item.transform[0] > 0 ? item.transform[4] : 0;
    const rawY = item.transform[5];

    // Skip standalone page numbers in header/footer zones
    const trimmed = item.str.trim();
    if (/^\d{1,4}$/.test(trimmed) && (rawY >= headerZone || rawY <= footerZone)) {
      continue;
    }

    if (!lineMap.has(y)) lineMap.set(y, []);
    lineMap.get(y).push({ text: item.str, x });
  }

  const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

  let lines = sortedYs.map((y) => {
    const lineItems = lineMap.get(y).sort((a, b) => a.x - b.x);
    return { y, text: lineItems.map((i) => i.text).join(' ').trim() };
  });

  if (lines.length === 0) return '';

  // Strip headers/footers: remove top and bottom lines that look like
  // page numbers or running headers
  if (lines.length > 3) {
    const isHeaderFooter = (line) => {
      const t = line.text.trim();
      if (/^\d{1,4}$/.test(t)) return true;
      if (/^(page\s+)?\d{1,4}$/i.test(t)) return true;
      return false;
    };

    // Check first two lines (top of page)
    while (lines.length > 3 && isHeaderFooter(lines[0])) {
      lines = lines.slice(1);
    }
    // Check last two lines (bottom of page)
    while (lines.length > 3 && isHeaderFooter(lines[lines.length - 1])) {
      lines = lines.slice(0, -1);
    }
  }

  // Remove inline page numbers: lines that are just a number and are
  // spatially isolated (large gap before and/or after)
  if (lines.length > 3) {
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      gaps.push(Math.abs(lines[i - 1].y - lines[i].y));
    }
    gaps.sort((a, b) => a - b);
    const medGap = gaps[Math.floor(gaps.length / 2)] || 12;

    lines = lines.filter((line, i) => {
      const t = line.text.trim();
      if (!/^\d{1,4}$/.test(t)) return true;
      // Keep it only if gaps around it are normal (i.e. it's actually part of content)
      const gapBefore = i > 0 ? Math.abs(lines[i - 1].y - line.y) : Infinity;
      const gapAfter = i < lines.length - 1 ? Math.abs(line.y - lines[i + 1].y) : Infinity;
      // If either gap is much larger than normal, it's a stray page number
      if (gapBefore > medGap * 2 || gapAfter > medGap * 2) return false;
      return true;
    });
  }

  // Calculate typical line gap (median gap between consecutive lines)
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = Math.abs(lines[i - 1].y - lines[i].y);
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 12;

  // A paragraph break = gap significantly larger than the typical line gap
  const paraThreshold = medianGap * 1.5;

  const paragraphs = [];
  let currentPara = [lines[0].text];

  for (let i = 1; i < lines.length; i++) {
    const gap = Math.abs(lines[i - 1].y - lines[i].y);
    if (gap > paraThreshold) {
      paragraphs.push(currentPara.join(' '));
      currentPara = [lines[i].text];
    } else {
      currentPara.push(lines[i].text);
    }
  }
  if (currentPara.length > 0) {
    paragraphs.push(currentPara.join(' '));
  }

  return paragraphs.join('\n\n');
}

export async function parsePdf(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let metadata = {};
  try {
    const meta = await pdf.getMetadata();
    metadata = meta?.info || {};
  } catch {}

  const title = metadata.Title || file.name.replace(/\.pdf$/i, '');
  const author = metadata.Author || '';

  const totalPages = pdf.numPages;
  const pageTexts = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const text = await extractPageText(page);
    pageTexts.push(text);
    if (onProgress) onProgress(Math.round((i / totalPages) * 100));
  }

  const fullText = pageTexts.join('\n\n');
  const allParagraphs = fullText.split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    // Remove standalone page numbers and very short noise lines
    .filter((p) => !(/^\d{1,4}$/.test(p)))
    .filter((p) => !(/^(page\s+)?\d{1,4}$/i.test(p)));

  if (allParagraphs.length === 0) {
    throw new Error("This PDF doesn't contain selectable text. Try a different version of the book.");
  }

  // Detect chapters — scan paragraphs for chapter headings
  const chapterBreaks = [];
  for (let i = 0; i < allParagraphs.length; i++) {
    if (isChapterHeading(allParagraphs[i])) {
      chapterBreaks.push({ index: i, title: allParagraphs[i].trim() });
    }
  }

  let chapters;

  if (chapterBreaks.length >= 2) {
    chapters = [];

    // If there's content before the first chapter heading, add it as "Front Matter"
    if (chapterBreaks[0].index > 0) {
      const frontContent = allParagraphs.slice(0, chapterBreaks[0].index);
      chapters.push({
        index: 0,
        title: 'Front Matter',
        content: frontContent.join('\n\n'),
      });
    }

    chapterBreaks.forEach((br, idx) => {
      const start = br.index;
      const end = idx < chapterBreaks.length - 1 ? chapterBreaks[idx + 1].index : allParagraphs.length;
      const contentParas = allParagraphs.slice(start + 1, end);
      chapters.push({
        index: chapters.length,
        title: br.title,
        content: contentParas.join('\n\n'),
      });
    });
  } else {
    // No chapters detected — split by ~3000 words at paragraph boundaries
    const CHUNK_SIZE = 3000;
    chapters = [];
    let currentChunk = [];
    let wordCount = 0;

    for (const para of allParagraphs) {
      const paraWords = para.split(/\s+/).length;
      if (wordCount + paraWords > CHUNK_SIZE && currentChunk.length > 0) {
        chapters.push({
          index: chapters.length,
          title: `Section ${chapters.length + 1}`,
          content: currentChunk.join('\n\n'),
        });
        currentChunk = [];
        wordCount = 0;
      }
      currentChunk.push(para);
      wordCount += paraWords;
    }
    if (currentChunk.length > 0) {
      chapters.push({
        index: chapters.length,
        title: `Section ${chapters.length + 1}`,
        content: currentChunk.join('\n\n'),
      });
    }
  }

  return { title, author, chapters };
}
