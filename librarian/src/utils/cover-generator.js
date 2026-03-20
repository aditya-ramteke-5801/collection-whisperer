// Generate a deterministic decorative SVG cover from a book title
// Uses a hash of the title to pick colors and patterns

function hashStr(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const PALETTES = [
  { bg: '#2C1810', accent: '#D4A574', text: '#F5E6C8' },  // dark mahogany
  { bg: '#1B2838', accent: '#8BA7C4', text: '#E8DFD0' },  // navy blue
  { bg: '#2D3B2D', accent: '#A8C49A', text: '#F0EDE4' },  // forest green
  { bg: '#3B2040', accent: '#C49AB8', text: '#F3ECE0' },  // plum
  { bg: '#382C1E', accent: '#C4A868', text: '#FAF6F0' },  // walnut
  { bg: '#1C2833', accent: '#7BA3B8', text: '#EDE4D4' },  // slate
  { bg: '#3C2415', accent: '#D4956A', text: '#F5E6C8' },  // burnt sienna
  { bg: '#2A2A3A', accent: '#9A9AB8', text: '#F3ECE0' },  // charcoal violet
];

const ORNAMENTS = [
  // Floral corner flourish
  (x, y, s, color) => `<path d="M${x} ${y} q${s} ${s/2} ${s*2} 0 q-${s/2} ${s} 0 ${s*2}" fill="none" stroke="${color}" stroke-width="1" opacity="0.3"/>`,
  // Diamond
  (x, y, s, color) => `<polygon points="${x},${y-s} ${x+s},${y} ${x},${y+s} ${x-s},${y}" fill="none" stroke="${color}" stroke-width="1" opacity="0.25"/>`,
  // Circle
  (x, y, s, color) => `<circle cx="${x}" cy="${y}" r="${s}" fill="none" stroke="${color}" stroke-width="1" opacity="0.2"/>`,
  // Star
  (x, y, s, color) => `<polygon points="${x},${y-s} ${x+s*0.3},${y-s*0.3} ${x+s},${y} ${x+s*0.3},${y+s*0.3} ${x},${y+s} ${x-s*0.3},${y+s*0.3} ${x-s},${y} ${x-s*0.3},${y-s*0.3}" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.2"/>`,
];

export function generateCoverSvg(title, author) {
  const h = hashStr(title + (author || ''));
  const palette = PALETTES[h % PALETTES.length];
  const ornament = ORNAMENTS[(h >> 4) % ORNAMENTS.length];

  // Wrap title text
  const words = title.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).length > 18 && current) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);

  const titleY = 110 - (lines.length - 1) * 14;
  const titleSvg = lines.map((line, i) =>
    `<text x="100" y="${titleY + i * 28}" text-anchor="middle" font-family="'EB Garamond', Georgia, serif" font-size="20" font-weight="700" fill="${palette.text}">${escapeXml(line)}</text>`
  ).join('');

  const authorSvg = author
    ? `<text x="100" y="${titleY + lines.length * 28 + 4}" text-anchor="middle" font-family="'EB Garamond', Georgia, serif" font-size="12" fill="${palette.accent}" opacity="0.8">${escapeXml(author)}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="${palette.bg}"/>
    <rect x="8" y="8" width="184" height="184" fill="none" stroke="${palette.accent}" stroke-width="0.5" opacity="0.4"/>
    <rect x="14" y="14" width="172" height="172" fill="none" stroke="${palette.accent}" stroke-width="0.3" opacity="0.3"/>
    <line x1="40" y1="${titleY - 20}" x2="160" y2="${titleY - 20}" stroke="${palette.accent}" stroke-width="0.5" opacity="0.4"/>
    <line x1="40" y1="${titleY + lines.length * 28 + (author ? 20 : 8)}" x2="160" y2="${titleY + lines.length * 28 + (author ? 20 : 8)}" stroke="${palette.accent}" stroke-width="0.5" opacity="0.4"/>
    ${ornament(30, 30, 12, palette.accent)}
    ${ornament(170, 30, 12, palette.accent)}
    ${ornament(30, 170, 12, palette.accent)}
    ${ornament(170, 170, 12, palette.accent)}
    ${titleSvg}
    ${authorSvg}
  </svg>`;

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
