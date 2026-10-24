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
        // Some clipboard providers attach an image/file alongside useful plain
        // text. Prefer the text; Quill otherwise routes this to its uploader
        // and silently loses the textual representation.
        const text = event.clipboardData?.getData('text/plain');
        if (text) {
          event.preventDefault();
          const range = this.quill.getSelection(true);
          if (range) this.onPaste(range, { html: '', text });
          return;
        }
        // URI-list/file-only behavior remains delegated to the app's uploader.
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
