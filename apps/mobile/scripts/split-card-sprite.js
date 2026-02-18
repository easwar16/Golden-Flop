/**
 * Splits a 52-card (+ back) sprite sheet into individual card images.
 * Expects: 1024x558 PNG, 4 rows x 13 columns for 52 cards (row 0=spades, 1=hearts, 2=diamonds, 3=clubs; col 0=A..col 12=K).
 * Card back: optional row 4 or first cell – we extract one back from (0,0) of a 5th row if height allows.
 * Run: node scripts/split-card-sprite.js
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE = path.join(__dirname, '../assets/images/cards-sheet.png');
const OUT_DIR = path.join(__dirname, '../assets/images/cards');

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const SUIT_CODES = ['s', 'h', 'd', 'c']; // spades, hearts, diamonds, clubs

const COLS = 13;
const ROWS = 4;
const IMG_W = 1024;
const IMG_H = 558;
const CARD_W = Math.floor(IMG_W / COLS);
const CARD_H = Math.floor(IMG_H / ROWS);

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error('Source image not found:', SOURCE);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const buf = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = buf.info;
  const data = buf.data;

  console.log('Image size:', width, 'x', height, 'channels:', channels);
  const cardW = Math.floor(width / COLS);
  const cardH = Math.floor(height / ROWS);
  console.log('Card size:', cardW, 'x', cardH);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const rank = RANKS[col];
      const suitCode = SUIT_CODES[row];
      const name = `${rank}${suitCode}.png`;
      const left = col * cardW;
      const top = row * cardH;
      const extract = await sharp(SOURCE)
        .extract({ left, top, width: cardW, height: cardH })
        .png()
        .toBuffer();
      fs.writeFileSync(path.join(OUT_DIR, name), extract);
      console.log('Wrote', name);
    }
  }

  // Card back: from row 4 if 5 rows (many sprite sheets put back on 5th row)
  const backTop = ROWS * cardH;
  if (backTop < height) {
    const backH = Math.min(cardH, height - backTop);
    const backW = cardW;
    const backLeft = Math.floor((width - backW) / 2);
    try {
      const backBuf = await sharp(SOURCE)
        .extract({ left: backLeft, top: backTop, width: backW, height: backH })
        .png()
        .toBuffer();
      fs.writeFileSync(path.join(OUT_DIR, 'back.png'), backBuf);
      console.log('Wrote back.png');
    } catch (e) {
      console.warn('Could not extract card back:', e.message);
    }
  }

  console.log('Done. Cards in', OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
