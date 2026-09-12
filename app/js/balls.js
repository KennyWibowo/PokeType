// SPDX-License-Identifier: AGPL-3.0-or-later
// Poké Ball icons, one per mode. Inline SVG rather than images: they are
// two flat colours and a band, they inherit the page's ink, and they stay sharp
// at the 20px the topbar uses and the 30px the mode cards use.
//
// Everything inside the ball is drawn as plain rectangles and clipped to the
// circle, so no accent has to be fitted to the curve by hand.

const BALLS = {
  safari: {
    label: 'Safari Ball',
    top: '#a3a86a',
    bottom: '#e9e7d8',
    // Camouflage: three slanted stripes down the dome.
    accents: `<g fill="#6f7a43">
        <path d="M4 34 24 -4h9L13 34Z"/>
        <path d="M24 34 44 -4h6L30 34Z"/>
        <path d="M44 34 62 -2h6L50 34Z"/>
      </g>`,
  },
  poke: {
    label: 'Poké Ball',
    top: '#ee2b37',
    bottom: '#f4f6fb',
    accents: '',
  },
  great: {
    label: 'Great Ball',
    top: '#2f7fe0',
    bottom: '#f4f6fb',
    // The two red shoulder flashes, with the white piping between them.
    accents: `<g>
        <path d="M2 30 14 2h8L12 30Z" fill="#e0352c"/>
        <path d="M42 2h8l12 28h-9Z" fill="#e0352c"/>
        <path d="M24 30 30 0h4l6 30Z" fill="#f4f6fb"/>
      </g>`,
  },
  ultra: {
    label: 'Ultra Ball',
    top: '#2b2d36',
    bottom: '#f4f6fb',
    // The yellow band, with the two uprights that make the "H".
    accents: `<g fill="#f2c231">
        <rect x="0" y="10" width="64" height="9"/>
        <rect x="14" y="0" width="9" height="29"/>
        <rect x="41" y="0" width="9" height="29"/>
      </g>`,
  },
  master: {
    label: 'Master Ball',
    top: '#6b3fa8',
    bottom: '#f4f6fb',
    accents: `<g>
        <circle cx="15" cy="14" r="5.5" fill="#f4f6fb"/>
        <circle cx="49" cy="14" r="5.5" fill="#f4f6fb"/>
        <path d="M23 29 26 7h5l3 7 3-7h5l3 22h-6l-1.5-11L32 25l-3.5-7L27 29Z" fill="#e05fa8"/>
      </g>`,
  },
  timer: {
    label: 'Timer Ball',
    top: '#f4f6fb',
    bottom: '#f4f6fb',
    // Black shoulders down either side of a white dome, with two red bands
    // across the middle of it — the clock face the item sprite reads as.
    accents: `<g>
        <rect x="0" y="0" width="13" height="30" fill="#2b2d36"/>
        <rect x="51" y="0" width="13" height="30" fill="#2b2d36"/>
        <rect x="13" y="8" width="38" height="5" fill="#e0352c"/>
        <rect x="13" y="19" width="38" height="5" fill="#e0352c"/>
      </g>`,
  },
  premier: {
    label: 'Premier Ball',
    top: '#f4f6fb',
    bottom: '#f4f6fb',
    band: '#e0352c',
    accents: '',
  },
};

// clipPath ids must be unique per document, and a page shows several balls.
let seq = 0;

/**
 * An <svg> element for one ball. `size` is the rendered pixel size; the
 * geometry is always drawn in a 64x64 box.
 */
export function pokeball(kind, size = 28) {
  const ball = BALLS[kind];
  if (!ball) throw new Error(`unknown ball: ${kind}`);
  const id = `ball-clip-${seq++}`;
  const band = ball.band || '#16181f';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `pokeball pokeball-${kind}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', ball.label);
  svg.innerHTML = `
    <defs><clipPath id="${id}"><circle cx="32" cy="32" r="30"/></clipPath></defs>
    <g clip-path="url(#${id})">
      <rect x="0" y="0" width="64" height="64" fill="${ball.bottom}"/>
      <rect x="0" y="0" width="64" height="32" fill="${ball.top}"/>
      ${ball.accents}
      <rect x="0" y="28.5" width="64" height="7" fill="${band}"/>
    </g>
    <circle cx="32" cy="32" r="30" fill="none" stroke="#16181f" stroke-width="3"/>
    <circle cx="32" cy="32" r="10.5" fill="#16181f"/>
    <circle cx="32" cy="32" r="6.5" fill="#f4f6fb"/>`;
  return svg;
}

export function ballLabel(kind) {
  return BALLS[kind].label;
}
