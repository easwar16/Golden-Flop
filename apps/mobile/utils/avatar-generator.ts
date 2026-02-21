/**
 * Deterministic pixel-art avatar generator.
 *
 * Returns a 5×5 color grid and palette; render with the <PixelAvatar> component
 * (see components/PixelAvatar). No external dependencies required.
 */

// FNV-1a 32-bit hash
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

// Mulberry32 PRNG
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0xffffffff;
  };
}

const PALETTE = [
  '#FF6B6B', '#FF8E53', '#FFD700', '#4CAF50',
  '#00BCD4', '#2196F3', '#9C27B0', '#E91E63',
  '#FF5722', '#8BC34A', '#03A9F4', '#673AB7',
];

export interface AvatarSpec {
  /** 5×5 grid – each cell is a hex color or null (transparent/bg) */
  grid: (string | null)[][];
  /** Primary fill color */
  color: string;
  /** Background color */
  bg: string;
}

export function generateAvatar(seed: string): AvatarSpec {
  const rng = seededRng(hash(seed));

  const color = PALETTE[Math.floor(rng() * PALETTE.length)];
  const hue = Math.floor(rng() * 360);
  const bg = `hsl(${hue}, 25%, 18%)`;

  // Build 5×3 left half then mirror horizontally for symmetry
  const grid: (string | null)[][] = [];
  for (let row = 0; row < 5; row++) {
    const cols: (string | null)[] = [];
    for (let col = 0; col < 3; col++) {
      cols.push(rng() > 0.42 ? color : null);
    }
    // Mirror: col[3]=col[1], col[4]=col[0]
    cols.push(cols[1]);
    cols.push(cols[0]);
    grid.push(cols);
  }

  return { grid, color, bg };
}
