/*
 * Lindungi konstruk Markdown/HTML yang belum dapat direpresentasikan Quill
 * tanpa kehilangan struktur. Bagian tersebut diganti token sebelum marked,
 * lalu dipulihkan sebagai blot raw read-only oleh markdown.js.
 */

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body',
  'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
  'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
  'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'pre', 'script',
  'search', 'section', 'style', 'summary', 'table', 'tbody', 'td', 'textarea',
  'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul'
]);

const SIMPLE_INLINE_TAGS = new Set([
  'a', 'b', 'br', 'code', 'del', 'em', 'i', 'img', 's', 'span', 'strong', 'u'
]);

const ALLOWED_ATTRIBUTES = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt'])
};

function fenceOpening(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  return { char: match[1].charAt(0), length: match[1].length };
}

function isFenceClosing(line, fence) {
  const match = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
  return !!(match && match[1].charAt(0) === fence.char && match[1].length >= fence.length);
}

function blockTagAt(line) {
  const match = line.match(/^ {0,3}<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/);
  if (!match) return null;
  const tag = match[1].toLowerCase();
  return BLOCK_TAGS.has(tag) ? tag : null;
}

function isSpecialHtmlStart(line) {
  if (/^ {0,3}(?:<!--|<\?|<!\[CDATA\[|<![A-Za-z])/.test(line)) return true;
  return blockTagAt(line) !== null;
}

function isComplexQuote(line) {
  const match = line.match(/^ {0,3}>[ \t]?(.*)$/);
  if (!match) return false;
  const content = match[1];
  return /^\s*>/.test(content) ||
    /^\s*(?:[-+*]|\d+[.)])\s+/.test(content) ||
    /^\s*#{1,6}\s/.test(content) ||
    /^\s*(?:`{3,}|~{3,})/.test(content) ||
    /^\s*\|/.test(content) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(content);
}

/* Menutupi code span agar HTML di dalamnya tidak memicu fallback raw. */
function maskInlineCode(line) {
  return line.replace(/(`+)[\s\S]*?\1/g, function (code) {
    return ' '.repeat(code.length);
  });
}

function safeColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(color) ||
    /^[a-zA-Z]{1,20}$/.test(color) ||
    /^rgba?\(\s*[\d.\s,%]+\)$/.test(color) ||
    /^hsla?\(\s*[\d.\s,%deg]+\)$/.test(color);
}

function isSafeSpan(tag) {
  const match = tag.match(/^<span\s+style\s*=\s*(["'])([\s\S]*?)\1\s*\/?\s*>$/i);
  if (!match) return false;
  const declarations = match[2].split(';').map(function (part) { return part.trim(); })
    .filter(Boolean);
  return declarations.length > 0 && declarations.every(function (declaration) {
    const parts = declaration.split(':');
    if (parts.length !== 2) return false;
    const name = parts[0].trim().toLowerCase();
    return (name === 'color' || name === 'background-color') && safeColor(parts[1]);
  });
}

function hasOnlyAllowedAttributes(rest, allowed) {
  const source = rest.replace(/\/\s*$/, '').trim();
  if (!source) return true;
  const pattern = /\s*([A-Za-z_:][\w:.-]*)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/gy;
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match || match.index !== offset || !match[2]) return false;
    if (!allowed.has(match[1].toLowerCase())) return false;
    offset = pattern.lastIndex;
  }
  return true;
}

/*
 * Inline HTML yang memiliki ekuivalen Quill boleh tetap melalui jalur visual.
 * Atribut yang akan hilang membuat seluruh blok dilindungi, bukan dibuang diam-diam.
 */
function isSupportedInlineTag(tag) {
  const match = tag.match(/^<(\/?)([A-Za-z][A-Za-z0-9-]*)([\s\S]*)>$/);
  if (!match) return true;
  const closing = match[1] === '/';
  const name = match[2].toLowerCase();
  if (!SIMPLE_INLINE_TAGS.has(name)) return false;
  if (closing) return /^<\/[A-Za-z][A-Za-z0-9-]*\s*>$/.test(tag) && name !== 'br' && name !== 'img';
  if (name === 'span') return isSafeSpan(tag);
  return hasOnlyAllowedAttributes(match[3], ALLOWED_ATTRIBUTES[name] || new Set());
}

function needsProtection(lines) {
  let fence = null;
  for (const original of lines) {
    if (fence) {
      if (isFenceClosing(original, fence)) fence = null;
      continue;
    }
    const opening = fenceOpening(original);
    if (opening) {
      fence = opening;
      continue;
    }
    if (/^(?: {4}|\t)/.test(original)) continue;
    const line = maskInlineCode(original);
    if (/<!--|-->/.test(line) || isComplexQuote(line) || isSpecialHtmlStart(line)) return true;
    const tags = line.match(/<\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])[^>]*>/g) || [];
    for (const tag of tags) {
      if (!isSupportedInlineTag(tag)) return true;
    }
  }
  return false;
}

function multilineRawEnd(lines, start) {
  const line = lines[start];
  if (line.includes('<!--') && !line.slice(line.indexOf('<!--') + 4).includes('-->')) {
    let end = start + 1;
    while (end < lines.length && !lines[end].includes('-->')) end++;
    return Math.min(end + 1, lines.length);
  }
  const tag = blockTagAt(line);
  if (!['script', 'pre', 'style', 'textarea'].includes(tag)) return null;
  const close = new RegExp('</' + tag + '\\s*>', 'i');
  if (close.test(line)) return null;
  let end = start + 1;
  while (end < lines.length && !close.test(lines[end])) end++;
  return Math.min(end + 1, lines.length);
}

/**
 * @returns {{source: string, blocks: Array<{token: string, markdown: string}>}}
 * `source` siap untuk marked; `blocks` adalah peta token -> Markdown asli.
 */
export function protectRawMarkdown(md) {
  const source = String(md == null ? '' : md).replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const output = [];
  const blocks = [];

  function protect(start, end) {
    const markdown = lines.slice(start, end).join('\n');
    let token = 'MARKRUSTRAWBLOCK' + blocks.length + 'TOKEN';
    while (source.includes(token)) token = 'X' + token;
    blocks.push({ token: token, markdown: markdown });
    output.push(token);
  }

  let i = 0;
  while (i < lines.length) {
    if (!lines[i].trim()) {
      output.push(lines[i]);
      i++;
      continue;
    }

    const fence = fenceOpening(lines[i]);
    if (fence) {
      output.push(lines[i]);
      i++;
      while (i < lines.length) {
        output.push(lines[i]);
        const closed = isFenceClosing(lines[i], fence);
        i++;
        if (closed) break;
      }
      continue;
    }

    if (/^(?: {4}|\t)/.test(lines[i])) {
      output.push(lines[i]);
      i++;
      continue;
    }

    // Komentar/script/pre/style/textarea dapat mengandung blank line. Ambil
    // sampai penutup, lalu sampai batas blank line agar token tetap terisolasi.
    const rawEnd = multilineRawEnd(lines, i);
    if (rawEnd !== null) {
      let end = rawEnd;
      while (end < lines.length && lines[end].trim()) end++;
      protect(i, end);
      i = end;
      continue;
    }

    // Kelompok blank-delimited dilindungi sebagai satu unit. Ini sengaja
    // konservatif: lebih baik read-only daripada struktur asli ditulis ulang.
    let end = i;
    while (end < lines.length && lines[end].trim()) end++;
    if (needsProtection(lines.slice(i, end))) protect(i, end);
    else output.push(...lines.slice(i, end));
    i = end;
  }

  return { source: output.join('\n'), blocks: blocks };
}
