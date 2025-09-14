/**
 * content.js — LATEST
 * Parent (form.jotform.com): autofill + consent + widget-select
 * Iframe (app-widgets.jotform.io): listen + click options + ACK
 */

/* ===== Tiny utils ===== */
const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const IS_PARENT = location.host === "form.jotform.com";
const IS_IFRAME = /\.jotform\.io$/.test(location.host);

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
  const aria = btn.getAttribute('aria-disabled'); if (aria && aria !== 'false') return true;
  if (/\bdisabled\b/i.test(btn.className) || /\bisDisabled\b/.test(btn.className)) return true;
  return getComputedStyle(btn).pointerEvents === 'none';
}

/* ===== Card helpers ===== */
function getActiveCard() {
  const cards = Array.from(document.querySelectorAll('.jfCard-wrapper.isVisible'));
  return cards.length ? cards[cards.length - 1] : null;
}

/* ===== Generic fillers ===== */
function fillInto(comp, part, val) {
  if (val == null || val === '') return false;
  const el = comp.querySelector(`input[data-component='${part}']`) ||
    comp.querySelector(`input[name*='[${part}]' i]`) ||
    comp.querySelector('input');
  if (!el) return false;
  if ((el.value || '') === String(val)) return true;
  el.focus();
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.blur();
  return true;
}
function digitsOnly(s) { return String(s || '').replace(/\D+/g, ''); }
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

  let el = comp.querySelector("input[id$='_full'][data-type='mask-number'], input.mask-phone-number, input.forPhone");
  if (el) { setValueWithEvents(el, digits); return true; }

  el = comp.querySelector('.iti .iti__tel-input, .iti input[type="tel"]');
  if (el) { setValueWithEvents(el, digits); return true; }

  const parts = qsa("input[data-component='area'], input[data-component='phone'], input[type='tel'][name*='area' i], input[type='tel'][name*='phone' i]", comp);
  if (parts.length >= 2) {
    const a = parts[0], b = parts[1], c = parts[2];
    const la = a.maxLength || 3, lb = b.maxLength || (c ? 3 : digits.length - la), lc = c?.maxLength || 4;
    setValueWithEvents(a, digits.slice(0, la));
    setValueWithEvents(b, digits.slice(la, la + lb));
    if (c) setValueWithEvents(c, digits.slice(la + lb, la + lb + lc));
    return true;
  }

  el = comp.querySelector("input[type='tel']");
  if (el) { setValueWithEvents(el, digits); return true; }

  return false;
}
function setLiteDate(fieldId, year, month, day) {
  if (month < 10) month = `0${month}`; if (day < 10) day = `0${day}`;
  const field = qs(`#lite_mode_${fieldId}`);
  if (!field) return false;
  const sep = field.getAttribute('data-seperator') || field.getAttribute('seperator') || '/';
  const fmt = field.getAttribute('data-format') || field.getAttribute('format') || 'mmddyyyy';
  let text = `${month}${sep}${day}${sep}${year}`;
  if (fmt === 'ddmmyyyy') text = `${day}${sep}${month}${sep}${year}`;
  if (fmt === 'yyyymmdd') text = `${year}${sep}${month}${sep}${day}`;
  field.value = text;
  const iso = qs(`#input_${fieldId}`); if (iso) iso.value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const ev = document.createEvent('HTMLEvents'); ev.initEvent('dataavailable', true, true); ev.eventName = 'date:changed'; qs(`#id_${fieldId}`)?.dispatchEvent(ev);
  return true;
}

/* ===== Consent / Agree helpers ===== */
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
  return /\bagree|accept|consent|terms|policy|privacy|understand|acknowledge|yes\b/.test(s);
}
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
function selectRadioAgree(comp, tokens = []) {
  const opts = getRadioOptions(comp);
  if (!opts.length) return false;
  const tks = (tokens || []).map(t => String(t).toLowerCase()).filter(Boolean);
  const synonyms = ['agree', 'i agree', 'accept', 'i accept', 'consent', 'yes', 'ok', 'okay', 'i understand', 'understand', 'acknowledge'];
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
  const inputs = Array.from(card.querySelectorAll("input[type='checkbox'], input[type='radio']"));
  const getLabelText = (el) => {
    const byFor = el.id ? card.querySelector(`label[for='${el.id}']`) : null;
    const wrap = el.closest('label');
    const own = (wrap?.innerText || byFor?.innerText || '').trim();
    const group = (card.querySelector('.jfQuestion-label, .jf-question-label, [id^=\"label_\"]')?.innerText || '').trim();
    return `${own} ${group}`.toLowerCase();
  };
  const keys = ['agree', 'accept', 'consent', 'i understand', 'understand', 'acknowledge', 'terms', 'policy', 'privacy', 'yes', 'ok', 'okay'];
  let changed = false;
  for (const el of inputs) {
    const txt = getLabelText(el);
    if (keys.some(k => txt.includes(k)) && !el.checked) {
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
      changed = true;
    }
  }
  return changed;
}

/* ===== Navigation ===== */
function clickNextOrSubmit(card, allowSubmit) {
  const next =
    card.querySelector("button[data-testid^='nextButton_']") ||
    card.querySelector("button.form-pagebreak-next") ||
    card.querySelector("button[name='next']");
  if (next && isVisible(next)) {
    if (isDisabledBtn(next)) {
      // mở khóa bằng cách auto tick consent nếu có
      tryAgreeToggles(card);
      if (isDisabledBtn(next)) return null;
    }
    next.scrollIntoView({ block: 'center' }); next.click(); return 'next';
  }
  if (allowSubmit) {
    const submit = card.querySelector("button[class*='form-submit-button']") ||
      document.querySelector("button[class*='form-submit-button']");
    if (submit && isVisible(submit) && !isDisabledBtn(submit)) {
      submit.scrollIntoView({ block: 'center' }); submit.click(); return 'submitted';
    }
  }
  return null;
}
function hasValidationErrors() {
  return !!(
    document.querySelector('#cardProgress .jfProgress-item.hasError') ||
    document.querySelector('.form-button-error') ||
    document.querySelector('.jfCard-actionsNotification .form-error-message') ||
    document.querySelector('li.form-line-error, .form-validation-error, [aria-invalid="true"]')
  );
}

/* ===== Widget (parent) helpers ===== */
function getWidgetComponents(card) {
  // card (#cid_xx) nằm BÊN TRONG li.form-line[data-type="control_widget"]
  const li = card?.closest('li.form-line[data-type="control_widget"]');
  const out = (li && isVisible(li)) ? [li] : [];
  const titleEl = card.querySelector('.jsQuestionLabelContainer');
  const title = titleEl ? titleEl.textContent.trim() : '(no title)';
  console.log(`Card: ${card.id} | Title: ${title} | Widget count: ${out.length}`);
  return out;

  // const widgets = qsa('li.form-line[data-type="control_widget"]', card).filter(isVisible);

  // // Lấy tiêu đề card (ví dụ "Day 1")
  // const titleEl = card.querySelector('.jsQuestionLabelContainer');
  // const title = titleEl ? titleEl.textContent.trim() : '(no title)';

  // console.log(`Card: ${card.id} | Title: ${title} | Widget count: ${widgets.length}`);
  // return widgets;
}
const hasWidgetInCard = (card) => getWidgetComponents(card).length > 0;

function findWidgetIframeInComp(comp) {
  const sel = [
    "iframe.custom-field-frame",
    "iframe[id^='customFieldFrame_']",
    "iframe[src*='app-widgets.jotform.io']",
    "iframe[src*='widgets.jotform.io']"
  ].join(',');
  const ifr = comp.querySelector(sel);
  return (ifr && isVisible(ifr)) ? ifr : null;
}
function waitForWidgetIframeInComp(comp, { appearTimeout = 4000, loadTimeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const ready = () => {
      const ifr = findWidgetIframeInComp(comp);
      if (!ifr) return null;
      if (ifr.contentDocument?.readyState === 'complete') return ifr;
      return ifr;
    };
    const now = ready();
    if (now) {
      if (now.contentDocument?.readyState === 'complete') { resolve(now); return; }
      const onLoad = () => { now.removeEventListener('load', onLoad); resolve(now); };
      now.addEventListener('load', onLoad, { once: true });
      setTimeout(() => { now.removeEventListener('load', onLoad); resolve(now); }, loadTimeout);
      return;
    }
    const kill = setTimeout(() => { obs.disconnect(); resolve(null); }, appearTimeout);
    const obs = new MutationObserver(() => {
      const ifr = ready();
      if (!ifr) return;
      clearTimeout(kill);
      obs.disconnect();
      if (ifr.contentDocument?.readyState === 'complete') { resolve(ifr); return; }
      const onLoad = () => { ifr.removeEventListener('load', onLoad); resolve(ifr); };
      ifr.addEventListener('load', onLoad, { once: true });
      setTimeout(() => { ifr.removeEventListener('load', onLoad); resolve(ifr); }, loadTimeout);
    });
    obs.observe(comp, { childList: true, subtree: true });
  });
}

// Parent → Iframe: handshake + select
async function selectWidgetOptionsInCard(card, tokens = [], timeout = 4000) {
  const comps = getWidgetComponents(card);
  if (!comps.length || !tokens?.length) return false;

  let changed = false;

  for (const comp of comps) {
    const iframe = await waitForWidgetIframeInComp(comp, { appearTimeout: 1500, loadTimeout: 1500 });
    if (!iframe) continue;

    const win = iframe.contentWindow;
    const origin = iframe.src ? new URL(iframe.src).origin : "*";

    let done = false;
    const start = Date.now();

    const cleanup = () => window.removeEventListener("message", onMsg);

    const onMsg = (ev) => {
      if (ev.source !== win) return;
      const data = ev.data || {};

      if (data.type === "JF_WIDGET_PONG") {
        // iframe ready → gửi select ngay
        win.postMessage({ type: "JF_WIDGET_SELECT", tokens }, origin);
      }
      if (data.type === "JF_WIDGET_SELECTED") {
        changed = changed || !!data.changed;
        done = true;
        cleanup();
      }
    };

    window.addEventListener("message", onMsg);

    // gửi ping ngay
    win.postMessage({ type: "JF_WIDGET_PING" }, origin);

    // chờ ACK, fallback retry 1–2 lần thay vì spam
    while (!done && Date.now() - start < timeout) {
      await delay(300);
      if (!done) win.postMessage({ type: "JF_WIDGET_PING" }, origin);
    }

    cleanup();
  }

  return changed;
}


/* ===== Widget (iframe) logic ===== */
function waitWidgetReady(maxTime = 5000) {
  return new Promise((resolve) => {
    const ok = () => document.querySelector('#gr_list label.checkbox, #checklist label.checkbox, ul.checklist label.checkbox');
    if (ok()) { resolve(true); return; }
    const obs = new MutationObserver(() => { if (ok()) { obs.disconnect(); resolve(true); } });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(!!ok()); }, maxTime);
  });
}
function dispatchMouseSeq(node) {
  const o = { bubbles: true, cancelable: true, view: window };
  node.dispatchEvent(new MouseEvent('pointerdown', o));
  node.dispatchEvent(new MouseEvent('mousedown', o));
  node.dispatchEvent(new MouseEvent('mouseup', o));
  node.dispatchEvent(new MouseEvent('click', o));
}
function isWidgetLabelDisabled(labelEl) {
  const cls = labelEl.className || '';
  if (/\bline-through\b/.test(cls) || /\btext-muted\b/.test(cls) || /\bdisabled\b/.test(cls)) return true;
  const badge = labelEl.parentElement?.querySelector('.items-left, span.items-left');
  const txt = (badge?.textContent || '').toLowerCase();
  return txt.includes('none') || /\b0\s*available\b/.test(txt);
}
function clickWidgetByTokens(tokens = [], root = document) {
  const list = root.querySelector('#gr_list, #checklist, ul.checklist');
  if (!list) return false;
  const wanted = (tokens || []).map(s => String(s).trim().toLowerCase()).filter(Boolean);
  let changed = false;
  for (const lab of list.querySelectorAll('label.checkbox')) {
    const text = (lab.textContent || '').trim().toLowerCase();
    const forId = (lab.getAttribute('for') || '').trim().toLowerCase();
    const match = wanted.some(w => text.includes(w) || forId === w);
    if (!match) continue;
    if (isWidgetLabelDisabled(lab)) continue;

    const input = forId ? document.getElementById(forId) : null;
    if (input && input.checked) { changed = true; continue; }

    const target = input || lab;
    target.scrollIntoView({ block: 'center' });
    dispatchMouseSeq(lab);
    if (input) {
      dispatchMouseSeq(input);
      if (!input.checked) input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    changed = true;
  }
  return changed;
}
if (IS_IFRAME && !window.__JF_IFRAME_READY__) {
  window.__JF_IFRAME_READY__ = true;
  window.addEventListener('message', async (ev) => {
    const data = ev.data || {};
    if (data.type === 'JF_WIDGET_PING') {
      ev.source.postMessage({ type: 'JF_WIDGET_PONG' }, ev.origin || "*");
      return;
    }
    if (data.type !== 'JF_WIDGET_SELECT') return;
    await waitWidgetReady(5000);
    const changed = clickWidgetByTokens(data.tokens || [], document);
    document.dispatchEvent(new Event('change', { bubbles: true }));
    ev.source.postMessage({ type: 'JF_WIDGET_SELECTED', changed }, ev.origin || "*");
  }, false);
}

/* ===== Main loop (parent) ===== */
async function mainLoop(payload) {
  const delayTime = Number(payload.delayTime) || 250;
  const allowSubmit = !!payload.submitForm;

  const year = Number(payload.year);
  const month = Number(payload.month);
  const day = Number(payload.day);

  const inputTxtArr = Array.isArray(payload.inputTxtArr) ? payload.inputTxtArr : [];
  const checkboxTxtArr = Array.isArray(payload.checkboxTxtArr) ? payload.checkboxTxtArr : [];
  const tokensForWidget = checkboxTxtArr.flat();

  let started = false, lastCardId = '';

  while (window.isFilling) {
    await delay(delayTime);

    // Page 0: Start
    if (!started) {
      const startBtn = qs("#jfCard-welcome-start");
      if (startBtn?.checkVisibility?.() || isVisible(startBtn)) { startBtn.click(); started = true; }
    }

    const card = getActiveCard();
    if (!card) continue;

    const cardId = card.id || '';
    if (cardId === lastCardId) {
      const a = clickNextOrSubmit(card, allowSubmit);
      if (a === 'next' || a === 'submitted') await delay(delayTime);
      continue; // không return
    }
    lastCardId = cardId;

    // ===== Per-field autofill =====
    const fieldId = (card.id || '').replace('cid_', '');
    const comps = qsa('[data-type]', card);
    for (const comp of comps) {
      const type = comp.getAttribute('data-type');
      switch (type) {
        case 'first': fillInto(comp, 'first', payload.firstName); break;
        case 'last': fillInto(comp, 'last', payload.lastName); break;
        case 'email': fillInto(comp, 'email', payload.email); break;
        case 'control_phone':
        case 'mask-number': await fillMaskedPhone(comp, payload.phone); break;
        case 'liteDate': setLiteDate(fieldId, year, month, day); break;

        case 'input-textbox': {
          const input = comp;
          const label =
            input.labels?.[0]?.querySelector('.jsQuestionLabelContainer')?.textContent?.trim() ||
            document.getElementById(input.getAttribute('aria-labelledby'))?.querySelector('.jsQuestionLabelContainer')?.textContent?.trim() ||
            document.querySelector(`label[for="${CSS.escape(input.id)}"] .jsQuestionLabelContainer`)?.textContent?.trim() || '';
          const map = inputTxtArr.find(m => (m.text || []).some(t => (label || '').toLowerCase().includes(String(t).toLowerCase())));
          if (map) {
            input.value = map.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          break;
        }

        // Consent radios
        case 'control_radio': {
          const labelText = getFieldLabelText(comp);
          const tokens = tokensForWidget; // reuse tokens nếu bạn pass "agree"/"yes" vào
          if (isConsentGroup(labelText) || (tokens.length && tokens.some(t => labelText.toLowerCase().includes(String(t).toLowerCase())))) {
            selectRadioAgree(comp, tokens);
          }
          break;
        }

        // Consent single checkbox
        case 'control_checkbox': {
          const boxes = comp.querySelectorAll("input[type='checkbox']");
          if (boxes.length === 1) {
            const labelText = getFieldLabelText(comp);
            if (isConsentGroup(labelText) && !boxes[0].checked) {
              boxes[0].click();
              boxes[0].dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
          break;
        }

        default: break;
      }
    }

    // ===== Widget only when present =====
    if (tokensForWidget.length && hasWidgetInCard(card)) {
      await selectWidgetOptionsInCard(card, tokensForWidget, 5000);
    }

    // Next / Submit
    const act = clickNextOrSubmit(card, allowSubmit);
    if (act === 'next') { await delay(delayTime); continue; }
    if (act === 'submitted') {
      await delay(1200);
      if (!hasValidationErrors()) { window.isFilling = false; break; }
      continue;
    }
  }
}

/* ===== Boot ===== */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== 'startFilling') return;
  window.isFilling = true;
  if (IS_PARENT) {
    Promise.resolve().then(() => mainLoop(msg.data || {}));
  }
  sendResponse({ ok: true });
  return false; // sync reply
});
