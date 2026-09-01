// Filter definitions. Each `grade` snippet is inlined into the fragment
// shader template in renderer.js and transforms `color` (vec3, 0-1).
// Available helpers: saturate(color, s), vignette(uv, start, amount),
// grain(uv), and uniforms u_time / u_outSize.

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
    pixelate: 120.0,
    grade: `
      color = floor(color * 7.0 + 0.5) / 7.0;
      color = saturate(color, 1.2);
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
