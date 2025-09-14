/* =========================
   Small utils
========================= */
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const delay = (ms) => new Promise(r => setTimeout(r, ms));

function isVisible(el) {
  if (!el) return false;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
  if ((el.offsetWidth | 0) === 0 && (el.offsetHeight | 0) === 0 && el.getClientRects().length === 0) return false;
  return true;
}
function isDisabledBtn(btn) {
  if (!btn) return true;
  if (btn.disabled || btn.matches?.(':disabled')) return true;
  const aria = btn.getAttribute('aria-disabled');
  if (aria && aria !== 'false') return true;
  const cls = btn.className || '';
  if (/\bdisabled\b/i.test(cls) || /\bisDisabled\b/.test(cls)) return true;
  return getComputedStyle(btn).pointerEvents === 'none';
}

/* =========================
   Phone helpers
========================= */
function digitsOnly(s) { return String(s || '').replace(/\D+/g, ''); }
function applyMaskFromPattern(mask, digits) {
  const placeholders = new Set(['_', '#', '9']);
  let out = '', i = 0;
  for (const ch of mask) out += placeholders.has(ch) ? (digits[i++] || '') : ch;
  return out;
}
function setValueWithEvents(el, val) {
  el.focus();
  el.setSelectionRange(0, (el.value || '').length);
  el.setRangeText('', 0, (el.value || '').length, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.value = val;
  el.setSelectionRange(val.length, val.length);
  el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: val }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
}
async function fillMaskedPhone(comp, phoneStr) {
  const digits = digitsOnly(phoneStr);
  if (!digits) return false;

  // (A) single masked input
  let el = comp.querySelector("input[id$='_full'][data-type='mask-number'], input.mask-phone-number, input.forPhone");
  if (el) {
    const mask = el.getAttribute('maskvalue') || el.getAttribute('data-maskvalue') || '(###) ###-####';
    const need = (mask.match(/[_#9]/g) || []).length;
    if (digits.length < need) return false;
    setValueWithEvents(el, applyMaskFromPattern(mask, digits));
    return true;
  }
  // (B) intl-tel-input
  el = comp.querySelector('.iti .iti__tel-input, .iti input[type="tel"]');
  if (el) { setValueWithEvents(el, digits); return true; }
  // (C) multi-part
  const parts = qsa("input[data-component='area'], input[data-component='phone'], input[type='tel'][name*='area' i], input[type='tel'][name*='phone' i]", comp);
  if (parts.length >= 2) {
    const a = parts[0], b = parts[1], c = parts[2];
    const la = a.maxLength || 3, lb = b.maxLength || (c ? 3 : digits.length - la), lc = c?.maxLength || 4;
    setValueWithEvents(a, digits.slice(0, la));
    setValueWithEvents(b, digits.slice(la, la + lb));
    if (c) setValueWithEvents(c, digits.slice(la + lb, la + lb + lc));
    return true;
  }
  // (D) fallback
  el = comp.querySelector("input[type='tel']");
  if (el) { setValueWithEvents(el, digits); return true; }
  return false;
}

/* =========================
   Labels & radios
========================= */
function getFieldLabelText(comp) {
  const input = comp.querySelector('input, textarea, select');
  const ariaIds = (input?.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  const pieces = ariaIds.map(id => (document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || ''));
  let text = pieces.join(' ').trim();
  if (!text) {
    const container = comp.closest("li[id^='id_'], [data-type]") || comp;
    const labelEl =
      container.querySelector('.jfQuestion-label, .jf-question-label, .form-label') ||
      container.querySelector("[id^='label_']") ||
      container.querySelector('label');
    if (labelEl) text = (labelEl.innerText || labelEl.textContent || '').trim();
  }
  return text.replace(/\*\s*$/, '').replace(/\bThis field is required\.?$/i, '').replace(/\s+/g, ' ').trim();
}
function isConsentGroup(labelText) {
  const s = (labelText || '').toLowerCase();
  return /\bagree|agreed|accept|consent|terms|policy|privacy|understand\b/.test(s);
}
function getRadioOptions(comp) {
  return qsa("input[type='radio']", comp).map(input => {
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
function selectRadioAgree(comp, tokens = []) {
  const opts = getRadioOptions(comp);
  if (!opts.length) return false;
  const tks = (tokens || []).map(t => String(t).toLowerCase()).filter(Boolean);
  const synonyms = ['agree', 'i agree', 'accept', 'i accept', 'consent', 'yes', 'ok', 'okay', 'i understand'];
  const hit = opts.find(o => {
    const tx = o.text.toLowerCase(), vv = o.value.toLowerCase();
    return (tks.length && tks.some(t => tx.includes(t) || vv.includes(t))) ||
      synonyms.some(t => tx.includes(t) || vv.includes(t));
  });
  if (!hit) return false;
  if (!hit.input.checked) {
    hit.input.click();
    hit.input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}
function tryAgreeToggles(card) {
  const inputs = qsa("input[type='checkbox'], input[type='radio']", card);
  const getLabelText = (el) => {
    const byFor = el.id ? card.querySelector(`label[for='${el.id}']`) : null;
    const wrap = el.closest('label');
    const own = (wrap?.innerText || byFor?.innerText || '').trim();
    const group = (card.querySelector('.jfQuestion-label, .jf-question-label, [id^="label_"]')?.innerText || '').trim();
    return `${own} ${group}`.toLowerCase();
  };
  const agreeTokens = ['agree', 'i agree', 'agreed', 'accept', 'i accept', 'consent', 'yes', 'ok', 'okay', 'i understand', 'understand', 'terms', 'policy', 'privacy'];
  let changed = false;
  for (const el of inputs) {
    const txt = getLabelText(el);
    if (agreeTokens.some(t => txt.includes(t)) && !el.checked) {
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
      changed = true;
    }
  }
  return changed;
}

/* =========================
   Widget helpers (giftRegistry / checklist)
   → dùng checkboxTxtArr để match theo text HOẶC id (for="option-x")
========================= */
function widgetOptions(root = document) {
  const list = root.querySelector('#gr_list, #checklist, ul.checklist');
  if (!list) return [];
  return [...list.querySelectorAll('label.checkbox')].map(lab => ({
    labelEl: lab,
    text: (lab.textContent || '').trim(),
    forId: lab.getAttribute('for') || ''
  }));
}
function clickWidgetByTokens(tokens = [], root = document) {
  const opts = widgetOptions(root);
  if (!opts.length) return false;
  const wanted = (tokens || []).map(s => String(s).toLowerCase()).filter(Boolean);
  let changed = false;

  for (const o of opts) {
    const txt = o.text.toLowerCase();
    const byText = wanted.some(w => txt.includes(w));
    const byId = wanted.includes(o.forId.toLowerCase());
    if (byText || byId) { o.labelEl.click(); changed = true; }
  }
  return changed;
}

/* =========================
   Per-field fillers & navigation
========================= */
function fillInto(componentRoot, partName, value) {
  if (!value) return false;
  const el = qs(`input[data-component='${partName}']`, componentRoot);
  if (!el) return false;
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}
function setLiteDate(fieldId, year, month, day) {
  try {
    if (month < 10) month = `0${month}`;
    if (day < 10) day = `0${day}`;
    const field = qs(`#lite_mode_${fieldId}`);
    const sep = field.getAttribute('data-seperator') || field.getAttribute('seperator') || '/';
    const fmt = field.getAttribute('data-format') || field.getAttribute('format') || 'mmddyyyy';
    let text = `${month}${sep}${day}${sep}${year}`;
    if (fmt === 'ddmmyyyy') text = `${day}${sep}${month}${sep}${year}`;
    if (fmt === 'yyyymmdd') text = `${year}${sep}${month}${sep}${day}`;
    field.value = text;
    const iso = qs(`#input_${fieldId}`);
    if (iso) iso.value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const ev = document.createEvent('HTMLEvents');
    ev.initEvent('dataavailable', true, true);
    ev.eventName = 'date:changed';
    qs(`#id_${fieldId}`).dispatchEvent(ev);
    return true;
  } catch { return false; }
}
function containsAny(allowedGroups, value) {
  const v = (value || '').toLowerCase();
  return allowedGroups.some(group => group.some(token => v.includes(String(token).toLowerCase())));
}
function clickNextOrSubmit(card, allowSubmit) {
  const nextBtn =
    card.querySelector("button[data-testid^='nextButton_']") ||
    card.querySelector("button.form-pagebreak-next") ||
    card.querySelector("button[name='next']");
  if (nextBtn && isVisible(nextBtn)) {
    if (isDisabledBtn(nextBtn)) {
      tryAgreeToggles(card);
      if (isDisabledBtn(nextBtn)) return null;
    }
    nextBtn.scrollIntoView({ block: 'center' });
    nextBtn.click();
    return 'next';
  }
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

/* =========================
   Main loop (top frame)
========================= */
async function mainLoop(payload) {
  const delayTime = Number(payload.delayTime) || 250;
  const allowSubmit = !!payload.submitForm;
  const year = Number(payload.year);
  const month = Number(payload.month);
  const day = Number(payload.day);

  const inputTxtArr = Array.isArray(payload.inputTxtArr) ? payload.inputTxtArr : [];
  const checkboxTxtArr = Array.isArray(payload.checkboxTxtArr) ? payload.checkboxTxtArr : [];

  let started = false;
  let lastCardId = '';

  while (window.isFilling) {
    await delay(delayTime);

    if (!started) {
      const start = qs("[id='jfCard-welcome-start']");
      if (start?.checkVisibility?.() || isVisible(start)) { start.click(); started = true; }
    } else {
      try { qs("input[data-type='mask-number']").value = payload.phone || ''; } catch { }
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
      didAny = true;
    } else {
      for (const comp of components) {
        const type = comp.getAttribute('data-type');
        switch (type) {
          case 'first': didAny = fillInto(comp, 'first', payload.firstName) || didAny; break;
          case 'last': didAny = fillInto(comp, 'last', payload.lastName) || didAny; break;
          case 'email': didAny = fillInto(comp, 'email', payload.email) || didAny; break;
          case 'liteDate': didAny = setLiteDate(fieldId, year, month, day) || didAny; break;

          case 'input-textbox': {
            const input = comp;
            const label =
              input.labels?.[0]?.querySelector('.jsQuestionLabelContainer')?.textContent?.trim() ||
              document.getElementById(input.getAttribute('aria-labelledby'))?.querySelector('.jsQuestionLabelContainer')?.textContent?.trim() ||
              document.querySelector(`label[for="${CSS.escape(input.id)}"] .jsQuestionLabelContainer`)?.textContent?.trim() || '';
            const mapped = inputTxtArr.find(m => (m.text || []).some(t => (label || '').toLowerCase().includes(String(t).toLowerCase())));
            if (mapped) {
              input.value = mapped.value;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              didAny = true;
            }
            break;
          }

          case 'control_checkbox': {
            const boxes = qsa("input[type='checkbox']", comp);
            if (boxes.length === 1) {
              boxes[0].checked = true; didAny = true;
            } else {
              for (const box of boxes) {
                if (box.value && containsAny(checkboxTxtArr, box.value)) box.checked = true;
              }
              didAny = true;
            }
            break;
          }

          case 'mask-number':
          case 'control_phone': {
            const ok = await fillMaskedPhone(comp, payload.phone);
            didAny = ok || didAny;
            break;
          }

          case 'control_radio': {
            const labelText = getFieldLabelText(comp);
            const tokens = (checkboxTxtArr || []).flat(); // reuse user tokens
            const shouldAuto = isConsentGroup(labelText) ||
              (tokens.length && tokens.some(t => labelText.toLowerCase().includes(String(t).toLowerCase())));
            if (shouldAuto) {
              const ok = selectRadioAgree(comp, tokens);
              didAny = ok || didAny;
            }
            break;
          }

          default: break;
        }
      }
    }

    await delay(100); // cho iframe widget trong card kịp render
    const action = clickNextOrSubmit(card, allowSubmit);
    if (action === 'next') { await delay(delayTime); continue; }
    if (action === 'submitted') { window.isFilling = false; break; }
  }
}

/* =========================
   Entry point
   - Top frame: mainLoop
   - Widget iframe: chọn option dựa trên checkboxTxtArr
========================= */
chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'startFilling') return;
  const data = message.data;
  window.isFilling = true;

  if (location.host === 'form.jotform.com') {
    mainLoop(data);
    return;
  }

  // Iframe widget (giftRegistry/checklist)
  if (location.host.endsWith('jotform.io')) {
    try {
      const tokens = Array.isArray(data.checkboxTxtArr) ? data.checkboxTxtArr.flat() : [];
      if (tokens.length) {
        const did = clickWidgetByTokens(tokens, document);
        if (did) document.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (e) {
      // ignore
    }
  }
});
