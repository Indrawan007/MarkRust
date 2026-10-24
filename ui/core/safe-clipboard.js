import { sanitizeClipboardHtml } from './markdown.js';

const registered = new WeakSet();

// Register before constructing Quill. Both direct convert() and native HTML
// paste must be sanitized before Quill's own DOMParser sees any resource URL.
export function registerSafeClipboard(Quill) {
  if (registered.has(Quill)) return;
  const BaseClipboard = Quill.import('modules/clipboard');
  class SafeClipboard extends BaseClipboard {
    convert(input, formats) {
      const safe = input.html
        ? { ...input, html: sanitizeClipboardHtml(input.html) }
        : input;
      return super.convert(safe, formats);
    }

    onCapturePaste(event) {
      if (event.defaultPrevented || !this.quill.isEnabled()) return;
      const html = event.clipboardData?.getData('text/html');
      if (!html) {
        // Preserve Quill's plaintext, URI-list and local file upload behavior.
        return super.onCapturePaste(event);
      }
      event.preventDefault();
      const range = this.quill.getSelection(true);
      if (!range) return;
      // Do not call the base HTML capture handler: it parses raw HTML when
      // clipboard files are also present, before calling convert(). Prefer the
      // sanitized HTML representation rather than the upload heuristic.
      this.onPaste(range, {
        html: sanitizeClipboardHtml(html),
        text: event.clipboardData.getData('text/plain')
      });
    }
  }
  Quill.register('modules/clipboard', SafeClipboard, true);
  registered.add(Quill);
}
