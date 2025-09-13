// content.js

// Extract only digits from input string
function digitsOnly(s) {
  return String(s || '').replace(/\D+/g, '');
}

// Format "digits" into a visual mask "(###) ###-####" / "____-___" etc.
function applyMaskFromPattern(mask, digits) {
  // treat _, #, 9 as placeholders for digits
  const placeholders = new Set(['_', '#', '9']);
  let out = '';
  let i = 0;
  for (const ch of mask) {
    if (placeholders.has(ch)) {
      if (i < digits.length) out += digits[i++];
      else out += ''; // or keep placeholder if you want to show, but validator hates it
    } else {
      out += ch;
    }
  }
  return out;
}

// Fire a "realistic" sequence of events so JotForm validators run
function setValueWithEvents(el, val) {
  el.focus();
  // clear old value in a way frameworks detect
  el.setSelectionRange(0, (el.value || '').length);
  el.setRangeText('', 0, (el.value || '').length, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));

  // set the formatted value
  el.value = val;
  el.setSelectionRange(val.length, val.length);

  // notify listeners
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertFromPaste',
    data: val
  }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
}

// Fill a JotForm masked phone input (covers single field, multi-part, intl-tel-input)
async function fillMaskedPhone(comp, phoneStr) {
  const digits = digitsOnly(phoneStr);
  if (!digits) return false;

  // (A) The exact single full field (your screenshot): id like input_*_full, data-type=mask-number
  let el = comp.querySelector("input[id$='_full'][data-type='mask-number'], input.mask-phone-number, input.forPhone");
  if (el) {
    const mask = el.getAttribute('maskvalue') || el.getAttribute('data-maskvalue') || '(###) ###-####';
    // how many digits are required by the mask
    const need = (mask.match(/[_#9]/g) || []).length;
    if (digits.length < need) {
      // not enough digits → don't set (will fail validation)
      return false;
    }
    const formatted = applyMaskFromPattern(mask, digits);
    setValueWithEvents(el, formatted);
    return true;
  }

  // (B) intl-tel-input variant
  el = comp.querySelector('.iti .iti__tel-input, .iti input[type="tel"]');
  if (el) {
    setValueWithEvents(el, digits); // plugin formats visually
    return true;
  }

  // (C) Two/three-part phones (area + number, etc.)
  const parts = Array.from(
    comp.querySelectorAll(
      "input[data-component='area'], input[data-component='phone'], input[type='tel'][name*='area' i], input[type='tel'][name*='phone' i]"
    )
  );
  if (parts.length >= 2) {
    // guess lengths
    const a = parts[0], b = parts[1], c = parts[2];
    const la = a.maxLength || 3, lb = b.maxLength || (c ? 3 : digits.length - la), lc = c?.maxLength || 4;
    setValueWithEvents(a, digits.slice(0, la));
    setValueWithEvents(b, digits.slice(la, la + lb));
    if (c) setValueWithEvents(c, digits.slice(la + lb, la + lb + lc));
    return true;
  }

  // (D) Fallback: a single <input type="tel">
  el = comp.querySelector("input[type='tel']");
  if (el) {
    setValueWithEvents(el, digits);
    return true;
  }

  return false;
}

// Return normalized label text for a field container (works with label + span + aria-labelledby)
function getFieldLabelText(comp) {
  const input = comp.querySelector('input, textarea, select');
  const ariaIds = (input?.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  let pieces = [];
  for (const id of ariaIds) {
    const el = document.getElementById(id);
    if (el) pieces.push(el.innerText || el.textContent || '');
  }
  let text = pieces.join(' ').trim();

  if (!text) {
    const container = comp.closest("li[id^='id_'], [data-type]") || comp;
    const labelEl =
      container.querySelector('.jfQuestion-label, .jf-question-label, .form-label') ||
      container.querySelector("[id^='label_']") ||
      container.querySelector('label');
    if (labelEl) text = (labelEl.innerText || labelEl.textContent || '').trim();
  }

  return text
    .replace(/\*\s*$/, '')                              // trailing required star
    .replace(/\bThis field is required\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Decide whether a radio group looks like a consent/agree question
function isConsentGroup(labelText) {
  const s = (labelText || '').toLowerCase();
  return /\bagree|agreed|accept|consent|terms|policy|privacy|understand\b/.test(s);
}

// Collect radio options with their visible text
function getRadioOptions(comp) {
  return Array.from(comp.querySelectorAll("input[type='radio']")).map(input => {
    let txt = '';
    const wrap = input.closest('label');
    if (wrap) {
      const t = wrap.querySelector('.jfRadio-labelText') || wrap;
      txt = (t.innerText || t.textContent || '').trim();
    } else {
      const lab = comp.querySelector(`label[for='${input.id}']`);
      const t = lab?.querySelector('.jfRadio-labelText') || lab;
      if (t) txt = (t.innerText || t.textContent || '').trim();
    }
    return { input, text: txt, value: (input.value || '').trim() };
  });
}

// Pick an option matching tokens or consent synonyms
function selectRadioAgree(comp, tokens = []) {
  const opts = getRadioOptions(comp);
  if (!opts.length) return false;

  const tks = (tokens || []).map(t => String(t).toLowerCase()).filter(Boolean);
  const synonyms = ['agree', 'i agree', 'accept', 'i accept', 'consent', 'yes', 'ok', 'okay', 'i understand'];

  const match = (o) => {
    const tx = o.text.toLowerCase();
    const vv = o.value.toLowerCase();
    return (tks.length && tks.some(t => tx.includes(t) || vv.includes(t))) ||
      synonyms.some(t => tx.includes(t) || vv.includes(t));
  };

  const pick = opts.find(match) || null;
  if (!pick) return false;

  if (!pick.input.checked) {
    pick.input.click();                           // let JotForm handle checked state
    pick.input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

// Return true if at least one consent/agree control was toggled
function tryAgreeToggles(card) {
  // Collect all radios/checkboxes inside the visible card
  const inputs = Array.from(
    card.querySelectorAll("input[type='checkbox'], input[type='radio']")
  );

  // Build a label text for an input: its own label text + group label text
  const getLabelText = (el) => {
    const byFor = el.id ? card.querySelector(`label[for='${el.id}']`) : null;
    const wrap = el.closest('label');
    const own = (wrap?.innerText || byFor?.innerText || '').trim();

    // Group/question label (e.g. <label id="label_9"> ... <span>...text...</span>)
    const groupLabel =
      card.querySelector('.jfQuestion-label, .jf-question-label, [id^="label_"]');
    const group = (groupLabel?.innerText || '').trim();

    return `${own} ${group}`.toLowerCase();
  };

  // Keywords that indicate consent/agree options
  const agreeTokens = [
    'agree', 'i agree', 'agreed',
    'accept', 'i accept',
    'consent',
    'yes', 'ok', 'okay',
    'i understand', 'understand',
    'terms', 'policy', 'privacy'
  ];

  let changed = false;

  for (const el of inputs) {
    const txt = getLabelText(el);
    if (agreeTokens.some(t => txt.includes(t))) {
      if (!el.checked) {
        el.click(); // let JotForm handle state/validation
        el.dispatchEvent(new Event('change', { bubbles: true }));
        changed = true;
      }
    }
  }

  return changed;
}

function isVisible(el) {
  if (!el) return false;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
  if ((el.offsetWidth | 0) === 0 && (el.offsetHeight | 0) === 0 && el.getClientRects().length === 0) return false;
  return true;
}

function isDisabledBtn(btn) {
  if (!btn) return true;
  if (btn.disabled === true) return true;
  if (btn.matches?.(':disabled')) return true;
  const aria = btn.getAttribute('aria-disabled');
  if (aria && aria !== 'false') return true;
  const cls = btn.className || '';
  if (/\bdisabled\b/i.test(cls) || /\bisDisabled\b/.test(cls)) return true;
  const cs = getComputedStyle(btn);
  if (cs.pointerEvents === 'none') return true;
  return false;
}

//===============================================

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
    // const nextBtn = qs(`button[data-testid^='nextButton_']`, card);
    // if (nextBtn && nextBtn.checkVisibility()) {
    //   nextBtn.click();
    //   return true;
    // }
    // if (allowSubmit) {
    //   const submit = qs(`button[class*='form-submit-button']`, card);
    //   if (submit && submit.checkVisibility()) {
    //     submit.click();
    //     return true;
    //   }
    // }
    // return false;

    //===============
    // const nextBtn =
    //   card.querySelector("button[data-testid^='nextButton_']") ||
    //   card.querySelector("button.form-pagebreak-next");

    // if (nextBtn) { nextBtn.click(); return 'next'; }

    // if (allowSubmit) {
    //   const submit = card.querySelector("button[class*='form-submit-button']");
    //   if (submit) { submit.click(); return 'submitted'; }
    // }
    // return null;
    //===============

    const nextBtn =
      card.querySelector("button[data-testid^='nextButton_']") ||
      card.querySelector("button.form-pagebreak-next") ||
      card.querySelector("button[name='next']");

    if (nextBtn && isVisible(nextBtn)) {
      // If Next is disabled, try to enable by ticking agree/consent controls
      if (isDisabledBtn(nextBtn)) {
        const toggled = tryAgreeToggles(card); // ← new
        // Outer loop will wait a tick; just re-check now
        if (isDisabledBtn(nextBtn)) return null;
      }

      nextBtn.scrollIntoView({ block: 'center' });
      nextBtn.click();
      return 'next';
    }

    // Submit (last card)
    if (allowSubmit) {
      const submit =
        card.querySelector("button[class*='form-submit-button']") ||
        document.querySelector("button[class*='form-submit-button']");
      if (submit && isVisible(submit) && !isDisabledBtn(submit)) {
        submit.scrollIntoView({ block: 'center' });
        submit.click();
        return 'submitted';
      }
    }

    return null;
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

  function hasValidationErrors() {
    return !!(
      document.querySelector('#cardProgress .jfProgress-item.hasError') ||
      document.querySelector('.form-button-error') ||
      document.querySelector('.jfCard-actionsNotification .form-error-message') ||
      document.querySelector('li.form-line-error, .form-validation-error, [aria-invalid="true"]')
    );
  }


  async function handleProgressErrors(resolver) {
    const MAX_PASSES = 3;
    const TIMEOUT = 8000;
    const POLL = 200;

    const getErrorIds = () =>
      qsa('#cardProgress .jfProgress-item.hasError .jfProgress-itemLabel[data-item-id]')
        .map(n => n.dataset.itemId)
        .filter(Boolean);

    const gotoErrorCard = async (qid) => {
      const lbl = qs(`#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`);
      const item = lbl?.closest('.jfProgress-item');
      if (!item) return false;

      item.scrollIntoView({ block: 'center' });
      item.click();
      await delay(5000);
      const targetSel = `#cid_${qid}.isVisible`;
      const t0 = Date.now();
      while (Date.now() - t0 < TIMEOUT) {
        await delay(POLL);
        if (item.classList.contains('isActive') || qs(targetSel)) break;
      }

      const scope = qs(`#id_${qid}`) || qs(`#cid_${qid}`) || qs('.jfCard-wrapper.isVisible');
      scope?.querySelector('input,textarea,select,[tabindex]')?.focus();
      return true;
    };

    const waitCleared = async (qid) => {
      const sel = `#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`;
      const t0 = Date.now();
      while (Date.now() - t0 < TIMEOUT) {
        await delay(POLL);
        const item = qs(sel)?.closest('.jfProgress-item');
        if (!item || !item.classList.contains('hasError')) return true;
      }
      return false;
    };

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const errorIds = getErrorIds();
      if (!errorIds.length) return 0;

      for (const qid of errorIds) {
        await gotoErrorCard(qid);
        await resolver({ qid });      // <-- your fixer
        await waitCleared(qid);
      }
    }
    return getErrorIds().length; // remaining errors after passes
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
        } catch { }
      } else {
        // one-time: if there is a phone mask field anywhere, preload digits (will also be handled per-card)
        try {
          qs("input[data-type='mask-number']").value = payload.phone || '';
        } catch { }
      }

      const card = qs("div[class*='isVisible']");
      if (!card) continue;

      // const cardId = card.getAttribute('id') || '';
      // if (cardId === lastCardId) {
      //   if (clickNextOrSubmit(card, allowSubmit)) return;
      //   continue;
      // }
      const cardId = card.getAttribute('id') || '';
      if (cardId === lastCardId) {
        const action = clickNextOrSubmit(card, allowSubmit);
        if (action === 'next')      { await delay(delayTime); continue; }
        if (action === 'submitted') { window.isFilling = false; break; }
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
              const input = comp; // the <input data-type="input-textbox">
              const label =
                input.labels?.[0]?.querySelector('.jsQuestionLabelContainer')?.textContent?.trim() ||
                document.getElementById(input.getAttribute('aria-labelledby'))?.querySelector('.jsQuestionLabelContainer')?.textContent?.trim() ||
                document.querySelector(`label[for="${CSS.escape(input.id)}"] .jsQuestionLabelContainer`)?.textContent?.trim() ||
                '';

              // const label =
              //   comp.parentElement?.parentElement?.querySelector('label')?.innerText || '';
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

            // case 'mask-number': {
            //   // feed phone digits key-by-key to satisfy masks
            //   const digits = String(payload.phone || '').split('');
            //   for (const ch of digits) typeMasked(comp, ch);
            //   didAny = true;
            //   break;
            // }
            case 'mask-number': {
              const ok = await fillMaskedPhone(comp, payload.phone);
              didAny = ok || didAny;
              break;
            }

            case 'control_phone': { // outer container sometimes reports this type
              const ok = await fillMaskedPhone(comp, payload.phone);
              didAny = ok || didAny;
              break;
            }

            case 'control_radio': {
              const labelText = getFieldLabelText(comp);
              // Flatten your custom checkbox tokens so they can also drive radio selection
              const customTokens = (payload.checkboxTxtArr || []).flat();

              // Only auto-select if this looks like a consent group OR tokens match the group label
              const shouldAuto =
                isConsentGroup(labelText) ||
                (customTokens.length && customTokens.some(t => labelText.toLowerCase().includes(String(t).toLowerCase())));

              if (shouldAuto) {
                const ok = selectRadioAgree(comp, customTokens);
                didAny = ok || didAny;
              }
              break;
            }

            case 'control_widget': {
              const tokens = (payload.checkboxTxtArr || []).flat();
              if (!tokens.length) break;

              const frame = comp.querySelector('iframe');
              if (frame) {
                const origin = (() => { try { return new URL(frame.src).origin; } catch { return '*'; } })();
                const send = () => frame.contentWindow?.postMessage({ __af: true, kind: 'tickWidget', tokens }, origin);

                if (frame.complete || frame.contentDocument?.readyState === 'complete') send();
                else frame.addEventListener('load', send, { once: true });

                // small retry window in case widget re-renders list
                for (let i = 1; i <= 20; i++) setTimeout(send, i * 150);
              }

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
      const action = clickNextOrSubmit(card, allowSubmit);
      if (action === 'next') { await delay(delayTime); continue; }
      if (action === 'submitted') {
        await delay(5000); // let JotForm render errors
        if (!hasValidationErrors()) {
          window.isFilling = false; // all done
          return;
        }
        // There are validation errors - try to resolve them all
        // const payload = { ...payload }; // your payload if needed in resolver
        // Resolve ALL progress-bar errors (will no-op if none)
        const remaining = await handleProgressErrors(async ({ qid }) => {
          // Call your actual fixer
          await myResolveErrorItem({ qid, payload });
        });

        if (remaining === 0) {
          // No errors left → submit again (redirect to verify-human; we don't care)
          // trySubmitAgain();
          window.isFilling = false;
          break;
        }

        // Still errors → keep looping so your per-card logic can run again
        continue;
      }
    }
  }

// ===================== WIDGET MODE (runs inside app-widgets.jotform.io) =====================
const IS_WIDGET = /(^|\.)app-widgets\.jotform\.io$/.test(location.host);

if (IS_WIDGET) {
  console.log('[AF] widget mode', location.href);

  // Dispatch a realistic click sequence so widget JS updates hidden values
  function clickLikeUser(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(1, r.left + 5), y = Math.max(1, r.top + 5);
    const opts = (type, extra={}) => Object.assign({
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y
    }, extra);

    el.dispatchEvent(new PointerEvent('pointerdown', opts('pointerdown', {pointerType: 'mouse', pointerId: 1})));
    el.dispatchEvent(new MouseEvent('mousedown',   opts('mousedown',   {buttons: 1})));
    el.dispatchEvent(new PointerEvent('pointerup',   opts('pointerup', {pointerType: 'mouse', pointerId: 1})));
    el.dispatchEvent(new MouseEvent('mouseup',     opts('mouseup')));
    el.dispatchEvent(new MouseEvent('click',       opts('click')));
  }

  // Wait until the list items are rendered, then run cb()
  function whenListReady(cb) {
    const ready = () => document.querySelector('#gr_list li, .checklist li');
    if (ready()) return cb();
    const mo = new MutationObserver(() => { if (ready()) { mo.disconnect(); cb(); } });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  // MAIN: tick items by tokens; skip disabled / "None" / sold-out (line-through, disabled)
  function tickWidgetChecklist(tokens = []) {
    const want = (tokens || []).map(s => String(s).toLowerCase()).filter(Boolean);
    if (!want.length) return false;

    const root = document.querySelector('#gr_list, .checklist') || document;
    const rows = Array.from(root.querySelectorAll('li'));
    if (!rows.length) return false;

    let changed = false;

    for (const li of rows) {
      const input = li.querySelector("input[type='checkbox']");
      if (!input) continue;

      const disabled =
        input.disabled ||
        /\bline-through\b/.test(li.className) ||
        /\bdisabled\b/i.test(li.className);

      const rawText = (li.innerText || '')
        .replace(/\b\d+\s+available\b/ig, '')
        .replace(/\bnone\b/ig, '')
        .trim()
        .toLowerCase();

      const valText = (input.value || '').toLowerCase();
      const shouldPick = !disabled && want.some(w => rawText.includes(w) || valText.includes(w));
      if (!shouldPick) continue;

      if (!input.checked) {
        const label = li.querySelector(`label[for='${CSS.escape(input.id)}']`) || li.querySelector('label');
        // Prefer clicking label so widget logic runs
        clickLikeUser(label || input);

        // Fallback if click was swallowed by framework
        if (!input.checked) {
          input.checked = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          label?.classList.add('checked'); // purely cosmetic
        }
        changed = true;
      }
    }

    console.log('[AF] widget ticked =', changed);
    return changed;
  }

  // Receive tokens from extension (direct) or from top frame via postMessage
  chrome.runtime?.onMessage?.addListener?.((msg) => {
    if (msg?.action === 'tickWidget' || msg?.action === 'startFilling') {
      const tokens = (msg?.data?.checkboxTxtArr || []).flat();
      whenListReady(() => tickWidgetChecklist(tokens));
    }
  });

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.__af === true && d.kind === 'tickWidget') {
      whenListReady(() => tickWidgetChecklist(d.tokens || []));
    }
  });
}
// =================== END WIDGET MODE =====================



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

