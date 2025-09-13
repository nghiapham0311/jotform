// content.js
(function () {
  // helpers
  const qs = (sel, root = document) => root.querySelector(sel);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function fillInto(componentRoot, partName, value) {
    if (!value) return false;
    const el = qs(`input[data-component='${partName}']`, componentRoot);
    if (!el) return false;
    el.value = value;
    // fire change/input so JotForm reacts
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // Set a JotForm "liteDate" control value respecting its data-format / separator
  function setLiteDate(fieldId, year, month, day) {
    try {
      // pad
      if (month < 10) month = `0${month}`;
      if (day < 10) day = `0${day}`;

      const field = qs(`#lite_mode_${fieldId}`);
      const sep = field.getAttribute('data-seperator') || field.getAttribute('seperator') || '/';
      const fmt = field.getAttribute('data-format') || field.getAttribute('format') || 'mmddyyyy';

      let text = `${month}${sep}${day}${sep}${year}`;
      if (fmt === 'ddmmyyyy') text = `${day}${sep}${month}${sep}${year}`;
      if (fmt === 'yyyymmdd') text = `${year}${sep}${month}${sep}${day}`;
      if (fmt === 'mmddyyyy') text = `${month}${sep}${day}${sep}${year}`;

      field.value = text;

      // If the companion #input_<id> exists, set it in yyyy-mm-dd
      const iso = qs(`#input_${fieldId}`);
      if (iso) {
        iso.value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }

      // notify jotform
      const ev = document.createEvent('HTMLEvents');
      ev.initEvent('dataavailable', true, true);
      ev.eventName = 'date:changed';
      qs(`#id_${fieldId}`).dispatchEvent(ev);
      return true;
    } catch {
      return false;
    }
  }

  // Choose option text from provided mapping that matches the field's label text
  function findMappedValue(mappingList, labelText) {
    const needle = (labelText || '').toLowerCase();
    const hit = mappingList.filter(m =>
      (m.text || []).some(t => needle.includes(String(t).toLowerCase()))
    );
    return hit.length ? hit[0].value : null;
  }

  // For checkbox groups: does the candidate value contain any of allowed tokens?
  function containsAny(allowedGroups, value) {
    const v = (value || '').toLowerCase();
    return allowedGroups.some(group =>
      group.some(token => v.includes(String(token).toLowerCase()))
    );
  }

  // Click the "Next" button on card forms, or submit when allowed
  function clickNextOrSubmit(card, allowSubmit) {
    const nextBtn = qs(`button[data-testid^='nextButton_']`, card);
    if (nextBtn && nextBtn.checkVisibility()) {
      nextBtn.click();
      return true;
    }
    if (allowSubmit) {
      const submit = qs(`button[class*='form-submit-button']`, card);
      if (submit && submit.checkVisibility()) {
        submit.click();
        return true;
      }
    }
    return false;
  }

  // Type a mask-number (phone) by simulating key presses (works with some masked inputs)
  function typeMasked(el, digits = '') {
    const fireKey = (key) => {
      const payload = {
        code: key === ' ' ? 'Space' : key.toUpperCase(),
        key,
        keyCode: key.charCodeAt(0),
        which: key.charCodeAt(0),
        bubbles: true,
      };
      el.dispatchEvent(new KeyboardEvent('keydown', payload));
      el.dispatchEvent(new KeyboardEvent('keyup', payload));
      ['change', 'input'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
    };
    digits.split('').forEach(fireKey);
  }

  async function mainLoop(payload) {
    // payload from popup
    const delayTime = Number(payload.delayTime) || 250;
    const allowSubmit = !!payload.submitForm;

    const year = Number(payload.year);
    const month = Number(payload.month);
    const day = Number(payload.day);

    // text mappings: [{ value: "Universidad", text: ["Drivers Licence1","ID Number1"] }, ...]
    const inputTxtArr = Array.isArray(payload.inputTxtArr) ? payload.inputTxtArr : [];

    // checkbox matching buckets: [["Drivers Licence","ID Number"], ["..."]]
    const checkboxTxtArr = Array.isArray(payload.checkboxTxtArr) ? payload.checkboxTxtArr : [];

    let started = false;
    let lastCardId = '';

    while (window.isFilling) {
      await delay(delayTime);

      // click "Start" welcome card once
      if (!started) {
        try {
          const start = qs("[id='jfCard-welcome-start']");
          if (start?.checkVisibility()) {
            start.click();
            started = true;
          }
        } catch {}
      } else {
        // one-time: if there is a phone mask field anywhere, preload digits (will also be handled per-card)
        try {
          qs("input[data-type='mask-number']").value = payload.phone || '';
        } catch {}
      }

      const card = qs("div[class*='isVisible']");
      if (!card) continue;

      const cardId = card.getAttribute('id') || '';
      if (cardId === lastCardId) {
        if (clickNextOrSubmit(card, allowSubmit)) return;
        continue;
      }
      lastCardId = cardId;

      const fieldId = (card.getAttribute('id') || '').replace('cid_', '');
      let didAny = false;

      const components = qsa('[data-type]', card);
      if (components.length === 0) {
        didAny = true; // empty card, try to advance
      } else {
        for (const comp of components) {
          const type = comp.getAttribute('data-type');
          switch (type) {
            case 'first':
              didAny = fillInto(comp, 'first', payload.firstName) || didAny;
              break;

            case 'last':
              didAny = fillInto(comp, 'last', payload.lastName) || didAny;
              break;

            case 'email':
              didAny = fillInto(comp, 'email', payload.email) || didAny;
              break;

            case 'liteDate':
              didAny = setLiteDate(fieldId, year, month, day) || didAny;
              break;

            case 'input-textbox': {
              // grab label text to match from mapping
              const label =
                comp.parentElement?.parentElement?.querySelector('label')?.innerText || '';
              const mapped = findMappedValue(inputTxtArr, label);
              if (mapped) {
                const input = comp;
                input.value = mapped;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                didAny = true;
              }
              break;
            }

            case 'control_checkbox': {
              const boxes = qsa("input[type='checkbox']", comp);
              if (boxes.length === 1) {
                boxes[0].checked = true;
                didAny = true;
              } else {
                for (const box of boxes) {
                  if (box.value && containsAny(checkboxTxtArr, box.value)) {
                    box.checked = true;
                  }
                }
                didAny = true;
              }
              break;
            }

            case 'mask-number': {
              // feed phone digits key-by-key to satisfy masks
              const digits = String(payload.phone || '').split('');
              for (const ch of digits) typeMasked(comp, ch);
              didAny = true;
              break;
            }

            default:
              // ignore the rest
              break;
          }
        }
      }

      // advance the card form
      if (clickNextOrSubmit(card, allowSubmit)) return;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action !== 'startFilling') return;
    const data = message.data;

    window.isFilling = true;

    // only act on JotForm
    if (location.host === 'form.jotform.com') {
      mainLoop(data);
    }
  });
})();
