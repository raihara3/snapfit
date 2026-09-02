// Filter definitions. Each `grade` snippet is inlined into the fragment
// shader template in renderer.js and transforms `color` (vec3, 0-1).
// Available helpers: saturate(color, s), vignette(uv, start, amount),
// grain(uv), plus `textureUv` / u_tex / u_texScale for extra sampling
// and uniforms u_time / u_outSize.

// DawnBringer DB16: a general-purpose pixel-art palette. Mapping to a
// curated palette (instead of per-channel posterization) is what makes
// the pixel filter read as ドット絵 rather than a low-color GIF.
const PIXEL_ART_PALETTE = [
  '#140c1c', '#442434', '#30346d', '#4e4a4e',
  '#854c30', '#346524', '#d04648', '#757161',
  '#597dce', '#d27d2c', '#8595a1', '#6daa2c',
  '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6',
];

function hexToGlslVec3(hex) {
  const channels = [1, 3, 5].map((index) => (
    (parseInt(hex.slice(index, index + 2), 16) / 255).toFixed(4)
  ));
  return `vec3(${channels.join(', ')})`;
}

// GLSL ES 1.00 has no array constructors, so unroll the nearest-color
// search over the palette (luma-weighted distance for perceptual matches).
const paletteMatchGlsl = PIXEL_ART_PALETTE.map((hex) => `
      candidate = ${hexToGlslVec3(hex)};
      difference = color - candidate;
      candidateDistance = dot(difference * difference, vec3(0.3, 0.59, 0.11));
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
        bestColor = candidate;
      }`).join('');

export const FILTERS = [
  {
    id: 'normal',
    label: 'ノーマル',
    pixelate: 0,
    grade: '',
  },
  {
    id: 'film',
    label: 'フィルム',
    pixelate: 0,
    grade: `
      color = saturate(color, 0.88);
      color = pow(color, vec3(1.04, 1.0, 0.96));
      color = color * 0.92 + vec3(0.045, 0.05, 0.04);
      color.r += 0.015;
      color += (grain(uv) - 0.5) * 0.07;
      color *= vignette(uv, 0.42, 0.32);
    `,
  },
  {
    id: 'toy',
    label: 'トイ',
    pixelate: 0,
    grade: `
      color = saturate(color, 1.28);
      color = (color - 0.5) * 1.28 + 0.5;
      color.g += 0.015;
      color.b -= 0.02;
      color += (grain(uv) - 0.5) * 0.045;
      color *= vignette(uv, 0.28, 0.62);
    `,
  },
  {
    id: 'pixel',
    label: 'ドット',
    pixelate: 80.0,
    grade: `
      color = saturate(color, 1.15);
      // Bayer 4x4 ordered dithering, one threshold per output cell,
      // so gradients turn into retro cross-hatch patterns.
      vec2 cells = vec2(u_pixelate, u_pixelate * u_outSize.y / u_outSize.x);
      vec2 cell = floor(uv * cells);
      float fineBayer = mod(3.0 * mod(cell.y, 2.0) + 2.0 * mod(cell.x, 2.0), 4.0);
      float coarseBayer = mod(
        3.0 * mod(floor(cell.y / 2.0), 2.0) + 2.0 * mod(floor(cell.x / 2.0), 2.0),
        4.0
      );
      float bayer = (4.0 * fineBayer + coarseBayer) / 16.0;
      color += (bayer - 0.5) * 0.14;
      vec3 bestColor = vec3(0.0);
      vec3 candidate;
      vec3 difference;
      float bestDistance = 1e9;
      float candidateDistance;
${paletteMatchGlsl}
      color = bestColor;
    `,
  },
  {
    id: 'pale',
    label: 'ペール',
    pixelate: 0,
    grade: `
      color = saturate(color, 0.6);
      color = (color - 0.5) * 0.88 + 0.5;
      color = color * 1.04 + vec3(0.07);
      color.b += 0.012;
    `,
  },
  {
    id: 'vivid',
    label: 'ビビッド',
    pixelate: 0,
    grade: `
      color = saturate(color, 1.45);
      color = (color - 0.5) * 1.14 + 0.5;
      color.r += 0.012;
    `,
  },
  {
    id: 'mono',
    label: 'モノ',
    pixelate: 0,
    grade: `
      color = saturate(color, 0.0);
      color = (color - 0.5) * 1.12 + 0.5;
      color += (grain(uv) - 0.5) * 0.06;
      color *= vignette(uv, 0.4, 0.3);
    `,
  },
  {
    // Tilt-shift diorama look: a sharp horizontal focus band with the top
    // and bottom blurred (12-tap disc, radius growing toward the edges)
    // and punchy colors, so scenes read as miniatures.
    id: 'miniature',
    label: 'ミニチュア',
    pixelate: 0,
    grade: `
      float blurAmount = smoothstep(0.10, 0.40, abs(uv.y - 0.5));
      if (blurAmount > 0.001) {
        vec2 blurRadius = u_texScale * 0.011 * blurAmount;
        vec3 accum = color * 1.5;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(1.0, 0.0)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(-1.0, 0.0)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(0.0, 1.0)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(0.0, -1.0)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(0.707, 0.707)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(-0.707, 0.707)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(0.707, -0.707)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(-0.707, -0.707)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(0.5, 0.0)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(-0.5, 0.0)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(0.0, 0.5)).rgb;
        accum += texture2D(u_tex, textureUv + blurRadius * vec2(0.0, -0.5)).rgb;
        color = accum / 13.5;
      }
      color = saturate(color, 1.35);
      color = (color - 0.5) * 1.1 + 0.5;
    `,
  },
  {
    id: 'retro',
    label: 'レトロ',
    pixelate: 0,
    grade: `
      color = saturate(color, 0.82);
      color = color * 0.94 + vec3(0.05, 0.035, 0.02);
      color.r += 0.045;
      color.b -= 0.035;
      color *= vignette(uv, 0.45, 0.25);
    `,
  },
];

export function getFilter(filterId) {
  return FILTERS.find((filter) => filter.id === filterId) ?? FILTERS[0];
}
