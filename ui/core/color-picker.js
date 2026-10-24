// Enhance Quill's generated color pickers without replacing its format handlers.
export function enhanceColorPickers(container) {
  const win = container.ownerDocument.defaultView;
  for (const picker of container.querySelectorAll('.ql-color-picker')) {
    const label = picker.querySelector('.ql-picker-label');
    const options = picker.querySelector('.ql-picker-options');
    const items = [...options.querySelectorAll('.ql-picker-item')];
    const name = picker.classList.contains('ql-background') ? 'Warna latar teks' : 'Warna teks';
    label.setAttribute('aria-label', name);
    label.title = name;
    for (const item of items) {
      const value = item.getAttribute('data-value') || 'Default';
      item.setAttribute('aria-label', name + ': ' + value);
      item.title = name + ': ' + value;
    }
    function sync() {
      const open = picker.classList.contains('ql-expanded');
      for (const item of items) item.tabIndex = open ? 0 : -1;
    }
    function setOpen(open) {
      if (picker.classList.contains('ql-expanded') !== open) {
        // Quill owns expanded state, selected swatch, and the backing select.
        label.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
      }
      sync();
    }
    sync();
    new win.MutationObserver(sync).observe(picker, { attributes: true, attributeFilter: ['class'] });
    picker.addEventListener('focusout', (event) => {
      if (!picker.contains(event.relatedTarget)) setOpen(false);
    });
    picker.addEventListener('keydown', (event) => {
      const index = items.indexOf(event.target);
      if (event.target !== label && index < 0) return;
      if (event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        if (event.target === label) setOpen(!picker.classList.contains('ql-expanded'));
        else { event.target.click(); sync(); label.focus(); }
      } else if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
        const backwards = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : index < 0 ? (backwards ? items.length - 1 : 0)
          : (index + (backwards ? -1 : 1) + items.length) % items.length;
        items[next]?.focus();
      }
    });
  }
}
