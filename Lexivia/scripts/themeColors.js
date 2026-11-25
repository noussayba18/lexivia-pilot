// Adapt legacy page colors into shared semantic tokens at CSS compilation time.
// Fallbacks preserve the existing light design exactly, including CSS modules.
function tokenFor(hex, role) {
  let value = hex.slice(1);
  if (value.length === 3 || value.length === 4) value = [...value].map(c => c + c).join('');
  const rgb = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  const max = Math.max(...rgb), min = Math.min(...rgb);
  const lightness = (max + min) / 2;
  const saturation = max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
  const alpha = value.length === 8 ? parseInt(value.slice(6), 16) / 255 : 1;
  let token;
  if (role === 'surface') {
    if (lightness < .66) return hex; // Keep brand buttons and intentionally dark panels.
    token = lightness > .98 ? 'surface' : lightness > .94 ? 'canvas' : 'raised';
    if (saturation > .18 && lightness < .98) {
      token = rgb[0] > rgb[1] * 1.04 ? (rgb[1] > rgb[2] * 1.25 ? 'gold-soft' : 'coral-soft')
        : rgb[2] > rgb[1] * 1.05 ? 'navy-soft' : 'teal-soft';
    }
  } else if (role === 'border') {
    if (lightness < .5 && saturation > .35 && alpha === 1) return hex;
    token = 'line';
  } else {
    if (lightness > .88) return hex; // White text remains legible on brand buttons.
    token = lightness < .32 ? 'ink' : 'muted';
    if (saturation > .35 && lightness >= .32) {
      token = rgb[0] > rgb[1] * 1.25 ? (rgb[1] > rgb[2] * 1.3 ? 'gold' : 'coral')
        : rgb[1] > rgb[0] * 1.15 ? 'teal' : 'ink';
    }
  }
  const replacement = `var(--lx-${token}, ${alpha < 1 ? '#' + value.slice(0, 6) : hex})`;
  return alpha < 1
    ? `color-mix(in srgb, ${replacement} ${+(alpha * 100).toFixed(2)}%, transparent)`
    : replacement;
}

export default function themeColors() {
  return {
    postcssPlugin: 'lexivia-theme-colors',
    Once(root) {
      root.walkDecls(decl => {
        if (root.source?.input.file?.endsWith('BrandLogo.module.css')) return;
        if (decl.parent.selector?.includes('.theme-swatch')) return;
        const prop = decl.prop.toLowerCase();
        // Avoid reprocessing our semantic tokens, shadows, images, and illustration fills.
        if (prop.startsWith('--lx-') || /shadow|filter/.test(prop) || /image/.test(prop) && (prop !== 'background-image' || /url\(/i.test(decl.value))) return;
        let role = /^(background|background-color|background-image)$/.test(prop) ? 'surface'
          : /^(border|outline)(-|$)/.test(prop) ? 'border'
          : /^(color|caret-color|text-decoration-color)$/.test(prop) ? 'text' : null;
        if (prop.startsWith('--')) {
          role = /border|line/.test(prop) ? 'border'
            : /bg|background|surface|panel|card|soft|light|lite|mid/.test(prop) ? 'surface'
            : /text|muted|ink/.test(prop) ? 'text' : null;
        }
        if (!role) return;
        decl.value = themeValue(decl.value, role);
      });
    },
  };
}

export function themeValue(input, role) {
  let value = input.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/gi, (original, r, g, b, a = '1') => {
    const hex = '#' + [r, g, b].map(n => (+n).toString(16).padStart(2, '0')).join('') + (a === '1' ? '' : Math.round(+a * 255).toString(16).padStart(2, '0'));
    return tokenFor(hex, role) === hex ? original : hex;
  });
  value = value.replace(/#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b/gi, hex => tokenFor(hex, role));
  value = value.replace(/\b(white|black)\b/g, name => {
    const hex = name === 'white' ? '#ffffff' : '#000000';
    const next = tokenFor(hex, role);
    return next === hex ? name : next;
  });
  if (role === 'text') {
    value = value.replace(/var\((--(?:navy|primary|[\w-]*accent))\)/g, (_, name) => `var(--lx-ink, var(${name}))`);
  }
  return value;
}
