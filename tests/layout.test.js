// CSS cascade checks only: jsdom does not compute layout/overflow geometry.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

function setup() {
  const html = fs.readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  const dom = new JSDOM(html);
  const style = dom.window.document.createElement('style');
  style.textContent = fs.readFileSync(new URL('../ui/app.css', import.meta.url), 'utf8');
  dom.window.document.head.appendChild(style);
  return dom;
}

test('status groups permit wrapping and backup warning permits long-word breaks', () => {
  const dom = setup();
  const { document, getComputedStyle } = dom.window;
  try {
    for (const selector of ['#statusbar', '#document-notices']) {
      assert.equal(getComputedStyle(document.querySelector(selector)).flexWrap, 'wrap');
    }
    assert.equal(getComputedStyle(document.getElementById('sb-draft-error')).overflowWrap, 'anywhere');
  } finally { dom.window.close(); }
});

test('dialog centering overrides global reset and tall content can scroll', () => {
  const dom = setup();
  const { document, getComputedStyle } = dom.window;
  try {
    for (const id of ['image-dialog', 'recovery-dialog']) {
      const css = getComputedStyle(document.getElementById(id));
      assert.equal(css.marginTop, 'auto');
      assert.equal(css.marginLeft, 'auto');
      assert.equal(css.overflow, 'auto');
      assert.equal(css.maxHeight, 'calc(100vh - 32px)');
    }
  } finally { dom.window.close(); }
});

test('status is a compact floating panel anchored bottom-right, not a full-width footer', () => {
  const dom = setup();
  try {
    const css = dom.window.getComputedStyle(dom.window.document.getElementById('statusbar'));
    assert.equal(css.position, 'fixed');
    assert.equal(css.right, '16px');
    assert.equal(css.bottom, '16px');
    assert.equal(css.width, 'max-content');
    assert.equal(css.borderRadius, '12px');
    assert.equal(css.maxHeight, '40vh');
  } finally { dom.window.close(); }
});
