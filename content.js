/**
 * content.js — Priority single-select → Next select → Submit → detect QIDs → resolve → resubmit
 * Error resolver behavior:
 *  - On error card, try 1st priority; if unavailable, try 2nd, then 3rd...
 *  - If none of user's desired options are available, click NEXT (no selection).
 */

/* ===================== GLOBAL SELECTORS / CONSTANTS ===================== */
const IFRAME_SEL = "iframe.custom-field-frame, iframe[id^='customFieldFrame_'], iframe[src*='app-widgets.jotform.io'], iframe[src*='widgets.jotform.io']";
const LIST_SEL = "#gr_list, #checklist, ul.checklist";

/* ===== Tiny utils ===== */
const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const IS_PARENT = /\.jotform\.com$/i.test(location.host);
const IS_IFRAME = /\.jotform\.io$/i.test(location.host);

const norm = (s) => String(s || "").toLowerCase().trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function emitInputChange(el) { if (!el) return; try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch { } try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch { } }

/* ===================== Visibility / Disabled ===================== */
function isVisible(el) {
  if (!el) return false;
  if (el.hidden) return false;
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse" || cs.opacity === "0") return false;
  if ((el.offsetWidth | 0) === 0 && (el.offsetHeight | 0) === 0 && el.getClientRects().length === 0) return false;
  return true;
}
function isDisabledBtn(btn) {
  if (!btn) return true;
  if (btn.disabled || btn.matches?.(":disabled")) return true;
  const aria = btn.getAttribute("aria-disabled"); if (aria && aria !== "false") return true;
  if (/\bdisabled\b/i.test(btn.className) || /\bisDisabled\b/.test(btn.className)) return true;
  return getComputedStyle(btn).pointerEvents === "none";
}

/* ===================== Card helpers ===================== */
function getActiveCard() { const cards = qsa(".jfCard-wrapper.isVisible"); return cards.length ? cards[cards.length - 1] : null; }
function cardIdToQid(card) { return (card?.id || "").replace("cid_", ""); }
function getNextBtn(card) {
  return card.querySelector("button[data-testid^='nextButton_']") ||
    card.querySelector("button.form-pagebreak-next") ||
    card.querySelector("button[name='next']");
}

/* ===================== HELPERS (Day filter + Titles) ===================== */
function isSpecialEventTitle(title) { return /\bspecial\s*event\b/i.test(String(title || '')); }

function buildEnableDaysSet(arr) {
  const set = new Set();
  (Array.isArray(arr) ? arr : []).forEach(v => {
    if (typeof v === 'number' && Number.isFinite(v)) { if (v >= 1 && v <= 31) set.add(v); return; }
    const s = String(v ?? '').trim(); if (!s) return;
    const m = s.match(/^(\d+)\-(\d+)$/);
    if (m) { let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a]; for (let i = a; i <= b; i++) if (i >= 1 && i <= 31) set.add(i); }
    else { const n = parseInt(s, 10); if (!Number.isNaN(n) && n >= 1 && n <= 31) set.add(n); }
  });
  return set;  // size === 0 -> không tick card nào
}
function getCardTitleText(card) {
  const el = card.querySelector('.jsQuestionLabelContainer') ||
    card.querySelector('.jfQuestion-label, .jf-question-label, .form-label, [id^="label_"]');
  return (el?.textContent || '').trim();
}
function extractDayFromTitle(title) {
  const m = String(title || '').trim().match(/(\d{1,2})(?:st|nd|rd|th)?\s*$/i);
  return m ? parseInt(m[1], 10) : null;
}
function isCardEnabledByDays(card, enableDaysSpec) {
  const set = buildEnableDaysSet(enableDaysSpec);
  if (set.size === 0) return false;
  const n = extractDayFromTitle(getCardTitleText(card));
  return n != null && set.has(n);
}
function shouldTickCard(card, enabledDaysSet = null, includeSpecialEvent = false) {
  const title = getCardTitleText(card);
  const dayNum = extractDayFromTitle(title);
  const allowDay = (enabledDaysSet?.size > 0) && dayNum != null && enabledDaysSet.has(dayNum);
  const allowSpecial = !!includeSpecialEvent && isSpecialEventTitle(title);
  return allowDay || allowSpecial;
}

/* ===================== Generic fillers ===================== */
function fillInto(comp, part, val) {
  if (val == null || val === "") return false;
  const el = comp.querySelector(`input[data-component='${part}']`) ||
    comp.querySelector(`input[name*='[${part}]' i]`) ||
    comp.querySelector("input");
  if (!el) return false;
  if ((el.value || "") === String(val)) return true;
  el.focus(); el.value = String(val); emitInputChange(el); el.blur(); return true;
}
const digitsOnly = (s) => String(s || "").replace(/\D+/g, "");
function setValueWithEvents(el, val) {
  if (!el) return;
  el.focus();
  try { el.setSelectionRange(0, (el.value || "").length); el.setRangeText("", 0, (el.value || "").length, "end"); } catch { }
  try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch { }
  el.value = val;
  try { el.setSelectionRange(String(val).length, String(val).length); } catch { }
  try { el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: String(val) })); } catch { }
  emitInputChange(el); el.blur();
}
async function fillMaskedPhone(comp, phoneStr) {
  const digits = digitsOnly(phoneStr); if (!digits) return false;
  let el = comp.querySelector("input[id$='_full'][data-type='mask-number'], input.mask-phone-number, input.forPhone");
  if (el) { setValueWithEvents(el, digits); return true; }
  el = comp.querySelector(".iti .iti__tel-input, .iti input[type='tel']");
  if (el) { setValueWithEvents(el, digits); return true; }
  const parts = qsa("input[data-component='area'], input[data-component='phone'], input[type='tel'][name*='area' i], input[type='tel'][name*='phone' i]", comp);
  if (parts.length >= 2) {
    const [a, b, c] = parts;
    const la = a.maxLength || 3, lb = b.maxLength || (c ? 3 : digits.length - la), lc = c?.maxLength || 4;
    setValueWithEvents(a, digits.slice(0, la));
    setValueWithEvents(b, digits.slice(la, la + lb));
    if (c) setValueWithEvents(c, digits.slice(la + lb, la + lb + lc));
    return true;
  }
  el = comp.querySelector("input[type='tel']"); if (el) { setValueWithEvents(el, digits); return true; }
  return false;
}
function setLiteDate(fieldId, y, m, d) {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 10) m = `0${m}`; if (d < 10) d = `0${d}`;
  const field = qs(`#lite_mode_${fieldId}`); if (!field) return false;
  const sep = field.getAttribute("data-separator") || field.getAttribute("separator") ||
    field.getAttribute("data-seperator") || field.getAttribute("seperator") || "/";
  const fmt = field.getAttribute("data-format") || field.getAttribute("format") || "mmddyyyy";
  let text = `${m}${sep}${d}${sep}${y}`;
  if (fmt === "ddmmyyyy") text = `${d}${sep}${m}${sep}${y}`;
  if (fmt === "yyyymmdd") text = `${y}${sep}${m}${sep}${d}`;
  field.value = text;
  const iso = qs(`#input_${fieldId}`); if (iso) iso.value = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const ev = new CustomEvent("date:changed", { bubbles: true, cancelable: true, detail: { fieldId } });
  qs(`#id_${fieldId}`)?.dispatchEvent(ev); return true;
}

/* ===================== Consent helpers ===================== */
function getFieldLabelText(comp) {
  const input = comp.querySelector("input, textarea, select");
  const ariaIds = (input?.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
  const pieces = ariaIds.map(id => (document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || ""));
  let text = pieces.join(" ").trim();
  if (!text) {
    const container = comp.closest("li[id^='id_'], [data-type]") || comp;
    const labelEl = container.querySelector(".jfQuestion-label, .jf-question-label, .form-label") ||
      container.querySelector("[id^='label_']") || container.querySelector("label");
    if (labelEl) text = (labelEl.innerText || labelEl.textContent || "").trim();
  }
  return text.replace(/\*\s*$/, "").replace(/\bThis field is required\.?$/i, "").replace(/\s+/g, " ").trim();
}
function isConsentGroup(labelText) { const s = (labelText || "").toLowerCase(); return /\bagree|accept|consent|terms|policy|privacy|understand|acknowledge|yes\b/.test(s); }
function getRadioOptions(comp) {
  // First try to find radio group container
  const radioGroup = comp.querySelector('.form-radio, .form-single-radio, .jfRadio-container') || comp;
  
  // Get all radio inputs
  const radios = qsa("input[type='radio']", radioGroup).filter(input => {
    // Only include visible and enabled inputs
    const isVisible = !!(input.offsetWidth || input.offsetHeight || input.getClientRects().length);
    return isVisible && !input.disabled;
  });
  
  return radios.map(input => {
    let txt = "";
    
    // Try multiple ways to find the label text
    const wrap = input.closest("label");
    if (wrap) {
      // Check multiple possible label text containers
      const textElement = wrap.querySelector(".jfRadio-labelText") || 
                         wrap.querySelector(".form-radio-item-text") ||
                         wrap.querySelector(".radio-label-text") ||
                         wrap;
      txt = (textElement.innerText || textElement.textContent || "").trim();
    }
    
    // If no text found in wrapper, try finding associated label
    if (!txt && input.id) {
      const lab = comp.querySelector(`label[for='${input.id}']`);
      if (lab) {
        const textElement = lab.querySelector(".jfRadio-labelText") || 
                           lab.querySelector(".form-radio-item-text") ||
                           lab.querySelector(".radio-label-text") ||
                           lab;
        txt = (textElement.innerText || textElement.textContent || "").trim();
      }
    }
    
    // If still no text, try getting aria-label
    if (!txt) {
      txt = input.getAttribute('aria-label') || 
            input.getAttribute('title') || 
            input.value || "";
    }
    
    return { 
      input, 
      text: txt.trim(),
      value: (input.value || "").trim(),
      checked: input.checked,
      id: input.id
    };
  }).filter(opt => opt.text || opt.value); // Only return options that have either text or value
}
function selectRadioAgree(comp, tokens = []) {
  // Force find all radio inputs in component
  const radios = comp.querySelectorAll('input[type="radio"]');
  if (!radios.length) return false;

  // Create normalized token set for faster lookup
  const tokenSet = new Set([].concat(tokens)
    .map(t => String(t || '').toLowerCase().trim())
    .filter(Boolean));

  // Extended agreement keywords for better matching
  const agreeKeywords = [
    'agree', 'yes', 'accept', 'confirm', 'consent',
    'i agree', 'i accept', 'i confirm', 'i consent',
    'understand', 'acknowledged', 'continue', 'proceed',
    'ok', 'okay', 'next', 'submit'
  ];

  let success = false;
  for (const radio of radios) {
    if (radio.checked) continue;

    // Get all possible text sources
    const label = radio.closest('label') || document.querySelector(`label[for="${radio.id}"]`);
    const labelText = label?.textContent?.toLowerCase().trim() || '';
    const value = radio.value.toLowerCase().trim();
    const name = radio.name.toLowerCase().trim();
    const groupLabel = comp.querySelector('.form-label, .form-radio-label')?.textContent?.toLowerCase().trim() || '';

    // Check if this is an agreement option
    const isAgreeOption = agreeKeywords.some(keyword => 
      labelText.includes(keyword) || 
      value.includes(keyword) || 
      groupLabel.includes(keyword)
    );

    // Check if matches user tokens
    const matchesToken = tokenSet.size > 0 && 
      Array.from(tokenSet).some(token => 
        labelText.includes(token) || 
        value.includes(token) || 
        groupLabel.includes(token)
      );

    if (isAgreeOption || matchesToken) {
      try {
        // Try multiple selection methods
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        });

        // 1. Try clicking the label first
        if (label) {
          label.click();
          label.dispatchEvent(clickEvent);
        }

        // 2. If not checked, try clicking the radio directly
        if (!radio.checked) {
          radio.click();
          radio.dispatchEvent(clickEvent);
        }

        // 3. If still not checked, force it programmatically
        if (!radio.checked) {
          radio.checked = true;
          radio.setAttribute('checked', 'checked');
          
          // Force the events
          const changeEvent = new Event('change', { bubbles: true });
          const inputEvent = new Event('input', { bubbles: true });
          
          radio.dispatchEvent(changeEvent);
          radio.dispatchEvent(inputEvent);
          
          // Also dispatch on the form if available
          const form = radio.closest('form');
          if (form) {
            form.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }

        // If any method worked, mark as success
        if (radio.checked) {
          success = true;
          break;
        }
      } catch (e) {
        console.error('Radio selection error:', e);
        // Last resort
        try {
          radio.checked = true;
          radio.setAttribute('checked', 'checked');
          success = radio.checked;
        } catch {
          continue;
        }
      }
    }
  }

  return success;
}
function forceCheckInput(input) {
  if (input.checked) return true;
  
  try {
    // Try natural click first
    input.click();
    
    // If click didn't work, try programmatic checks
    if (!input.checked) {
      input.checked = true;
      input.setAttribute('checked', 'checked');
      
      // Dispatch events
      input.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Try clicking associated label
      const label = input.closest('label') || 
                   document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        label.click();
      }
    }
  } catch (e) {
    console.error('Error in input selection:', e);
    // Last resort
    input.checked = true;
    input.setAttribute('checked', 'checked');
  }
  
  return input.checked;
}

function tryAgreeToggles(card) {
  const inputs = qsa("input[type='checkbox'], input[type='radio']", card);
  const getTxt = (el) => {
    const byFor = el.id ? card.querySelector(`label[for='${el.id}']`) : null;
    const wrap = el.closest("label");
    const own = (wrap?.innerText || byFor?.innerText || "").trim();
    const group = (card.querySelector(".jfQuestion-label, .jf-question-label, [id^='label_']")?.innerText || "").trim();
    return `${own} ${group}`.toLowerCase();
  };
  
  const keys = [
    'agree', 'accept', 'consent', 'i understand', 'understand', 
    'acknowledge', 'terms', 'policy', 'privacy', 'yes', 'ok', 'okay'
  ];
  
  let changed = false;
  for (const el of inputs) {
    const txt = getTxt(el);
    if (keys.some(k => txt.includes(k)) && !el.checked) {
      changed = forceCheckInput(el) || changed;
    }
  }
  return changed;
}

/* ===================== Validation / Error flow ===================== */
function hasValidationErrors() {
  return !!(document.querySelector('#cardProgress .jfProgress-item.hasError') ||
    document.querySelector('.form-button-error') ||
    document.querySelector('.jfCard-actionsNotification .form-error-message') ||
    document.querySelector('li.form-line-error, .form-validation-error, [aria-invalid="true"]'));
}
function hasLineErrorInCard(card) {
  return !!(card.querySelector('li.form-line-error, .form-line.form-validation-error, li[aria-invalid="true"]') ||
    card.classList.contains('animate-shake') ||
    card.querySelector('.jfCard.animate-shake'));
}
async function waitErrorsReady({ timeout = 9000, poll = 150 } = {}) { const t0 = Date.now(); while (Date.now() - t0 < timeout) { await delay(poll); if (hasValidationErrors()) return true; } return hasValidationErrors(); }
function collectErrorQids() {
  const ids = new Set();
  qsa('#cardProgress .jfProgress-item.hasError .jfProgress-itemLabel[data-item-id]').forEach(n => { if (n.dataset.itemId) ids.add(n.dataset.itemId); });
  if (!ids.size) {
    qsa('li.form-line-error, li.form-line[aria-invalid="true"], .form-line.form-validation-error').forEach(li => { const id = (li.id || '').replace(/^id_/, '') || li.dataset.qid; if (id) ids.add(id); });
  }
  if (!ids.size) {
    const href = qs('.form-button-error a[href*="#cid_"]')?.getAttribute('href') || qs('.jfCard-actionsNotification a[href*="#cid_"]')?.getAttribute('href');
    const m = href && href.match(/#cid_(\d+)/); if (m) ids.add(m[1]);
  }
  return [...ids];
}
async function gotoCardByQid(qid, { timeout = 5000, poll = 150 } = {}) {
  const lbl = qs(`#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`); const item = lbl?.closest('.jfProgress-item');
  if (item) {
    item.scrollIntoView({ block: 'center' }); item.click(); const targetSel = `#cid_${qid}.isVisible`; const t0 = Date.now();
    while (Date.now() - t0 < timeout) { await delay(poll); if (item.classList.contains('isActive') || qs(targetSel)) break; }
  } else { try { location.hash = `#cid_${qid}`; } catch { } }
  const scope = qs(`#id_${qid}`) || qs(`#cid_${qid}`) || qs('.jfCard-wrapper.isVisible'); scope?.querySelector('input,textarea,select,[tabindex]')?.focus(); return true;
}

/* ===================== Widget (parent) helpers ===================== */
function getWidgetComponents(card) {
  if (!card) return [];
  let items = qsa("li.form-line[data-type='control_widget']", card).filter(isVisible);
  if (!items.length) { const li = card.closest("li.form-line[data-type='control_widget']"); if (li && isVisible(li)) items = [li]; }
  return items;
}
const hasWidgetInCard = (card) => getWidgetComponents(card).length > 0;

function findWidgetIframeInComp(comp) {
  const ifr = comp.querySelector(IFRAME_SEL);
  return (ifr && isVisible(ifr)) ? ifr : null;
}
function waitForWidgetIframeInComp(comp, { appearTimeout = 300, loadTimeout = 500 } = {}) {
  return new Promise(resolve => {
    const existingIframe = comp.querySelector(IFRAME_SEL);
    if (existingIframe) {
      if (existingIframe.contentDocument?.readyState === 'complete') { resolve(existingIframe); return; }
      const timeoutId = setTimeout(() => resolve(existingIframe), loadTimeout);
      existingIframe.addEventListener('load', () => { clearTimeout(timeoutId); resolve(existingIframe); }, { once: true });
      return;
    }

    const appearTimeoutId = setTimeout(() => resolve(null), appearTimeout);
    const observer = new MutationObserver((mutations, obs) => {
      const node = mutations.reduce((found, mutation) => 
        found || Array.from(mutation.addedNodes).find(n => n.nodeType === 1 && n.matches?.(IFRAME_SEL)), null);
      
      if (node) {
        obs.disconnect();
        clearTimeout(appearTimeoutId);
        if (node.contentDocument?.readyState === 'complete') { resolve(node); return; }
        const loadTimeoutId = setTimeout(() => resolve(node), loadTimeout);
        node.addEventListener('load', () => { clearTimeout(loadTimeoutId); resolve(node); }, { once: true });
      }
    });
    observer.observe(comp, { childList: true, subtree: true });
  });
}

/* ===================== PERF-UPGRADE: Parent → Iframe select via MessageChannel ===================== */
/** Parent → Iframe selection; returns {changed, picked} — FAST */
// Cache for widget selections
const widgetSelectionCache = new Map();

async function selectWidgetOptionsInCard(card, tokens = [], timeout = 150, { single = true } = {}) {
  if (!card) return { changed: false, picked: null };

  // Ensure tokens is properly formatted
  const normalizedTokens = (Array.isArray(tokens) ? tokens : [tokens])
    .filter(t => t != null)
    .map(t => String(t).toLowerCase().trim())
    .filter(Boolean);

  if (!normalizedTokens.length) return { changed: false, picked: null };

  const comps = getWidgetComponents(card);
  if (!comps.length) return { changed: false, picked: null };

  // Create cache key from card id and tokens
  const cacheKey = `${card.id}-${normalizedTokens.join(',')}`;
  
  // Check cache first
  if (widgetSelectionCache.has(cacheKey)) {
    return widgetSelectionCache.get(cacheKey);
  }

  // Process all components in parallel with optimized timing
  const componentResults = await Promise.all(comps.map(async comp => {
    // Try selection up to 2 times with short timeouts
    for (let attempt = 0; attempt < 2; attempt++) {
      const iframe = await waitForWidgetIframeInComp(comp, { appearTimeout: 100, loadTimeout: 150 });
      if (!iframe) continue;

      const origin = (() => { try { return new URL(iframe.src).origin; } catch { return "*"; } })();

      const result = await new Promise(resolve => {
        const ch = new MessageChannel();
        let settled = false;
        
        const finish = (res) => {
          if (!settled) {
            settled = true;
            if (res?.picked) {
              widgetSelectionCache.set(cacheKey, res);
            }
            resolve(res);
          }
        };

        const t = setTimeout(() => {
          try { ch.port1.close(); } catch {}
          finish(null);
        }, timeout);

        ch.port1.onmessage = (e) => {
          const d = e.data || {};
          if (d.type === "JF_WIDGET_SELECTED") {
            clearTimeout(t);
            try { ch.port1.close(); } catch {}
            const result = { 
              changed: !!d.changed, 
              picked: d.picked ?? null,
              values: d.values
            };
            finish(result);
          }
        };

        try {
          iframe.contentWindow.postMessage(
            { 
              type: "JF_WIDGET_SELECT_FAST", 
              tokens: normalizedTokens,
              single,
              attempt
            },
            origin,
            [ch.port2]
          );
        } catch (e) {
          clearTimeout(t);
          try { ch.port1.close(); } catch {}
          finish(null);
        }
      });

      if (result?.changed || result?.picked) {
        return result;
      }
    }
    return null;
  }));

  // Find the first successful result
  const firstSuccess = componentResults.find(r => r?.picked != null);
  if (firstSuccess) {
    return firstSuccess;
  }

  // Aggregate results if no clear success
  return componentResults.reduce((acc, r) => ({
    changed: acc.changed || !!r?.changed,
    picked: acc.picked ?? r?.picked,
    values: [...(acc.values || []), ...(r?.values || [])]
  }), { changed: false, picked: null, values: [] });

  const results = await Promise.all(tasks);
  const firstGood = results.find(r => r && r.picked != null);
  if (firstGood) return firstGood;

  let changed = false, picked = null;
  for (const r of results) { if (r) { changed = changed || r.changed; picked ??= r.picked; } }
  return { changed, picked };
}

/* ===== Parent → Iframe: NUDGE/CLEAR-INVALID ===== */
let __RESOLVING_ERRORS__ = false;
let __WATCHDOG_ENABLED__ = true;
// tightened timings for snappier progress
const T = { tick: 60, nextWait: 240, railTimeout: 1800, cardCleanTimeout: 1200, errorsWaitMax: 3500, stuckSameSig: 1800, hardResetAfter: 2 };

async function nudgeWidgetDirtyInCard(card, timeout = 900) {
  const comps = getWidgetComponents(card); if (!comps.length) return false;
  let nudged = false;
  for (const comp of comps) {
    const iframe = await waitForWidgetIframeInComp(comp, { appearTimeout: 250, loadTimeout: 500 }); if (!iframe) continue;
    const win = iframe.contentWindow; let origin = "*"; try { origin = new URL(iframe.src).origin; } catch { }
    let done = false;
    const onMsg = (ev) => {
      if (ev.source !== win) return; const d = ev.data || {};
      if (d.type === 'JF_WIDGET_VALUE_DIRTY' || d.type === 'JF_WIDGET_VALUE') nudged = true;
      if (d.type === 'JF_WIDGET_RESOLVED') { nudged = nudged || !!d.fixed; done = true; window.removeEventListener('message', onMsg); }
    };
    window.addEventListener('message', onMsg);
    try { win.postMessage({ type: 'JF_WIDGET_PING' }, origin); } catch { }
    setTimeout(() => { try { win.postMessage({ type: 'JF_WIDGET_RESOLVE', mode: 'clear-invalid' }, origin); } catch { } }, 10);
    const t0 = Date.now();
    while (!done && Date.now() - t0 < timeout) { await delay(80); try { win.postMessage({ type: 'JF_WIDGET_PING' }, origin); } catch { } }
    window.removeEventListener('message', onMsg);
    const hidden = comp.querySelector('input[type="hidden"], textarea'); emitInputChange(hidden);
  }
  return nudged;
}
async function clearInvalidAndUnlockNext(card, timeout = 900, { unlock = true } = {}) {
  const ok = await nudgeWidgetDirtyInCard(card, timeout);
  if (ok && unlock) {
    card.querySelectorAll(".jfCard-actionsNotification .form-error-message, .form-button-error").forEach(n => n.remove());
    const next = getNextBtn(card); if (next) {
      next.disabled = false; next.removeAttribute("disabled"); next.removeAttribute("aria-disabled");
      next.classList.remove("disabled", "isDisabled"); next.style.pointerEvents = "";
    }
  }
  return ok;
}

/* ===================== Iframe logic (SELECT + CLEAR-INVALID) ===================== */
function waitWidgetReady(maxTime = 5000) {
  return new Promise(resolve => {
    const ok = () => document.querySelector("#gr_list label.checkbox, #checklist label.checkbox, ul.checklist label.checkbox");
    if (ok()) { resolve(true); return; }
    const obs = new MutationObserver(() => { if (ok()) { obs.disconnect(); resolve(true); } });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(!!ok()); }, maxTime);
  });
}
function listRoot(root = document) { return root.querySelector(LIST_SEL); }
function labelFor(input, root = document) { return input?.id ? root.querySelector(`label[for='${CSS.escape(input.id)}']`) : null; }
function textWithoutBadges(el) { if (!el) return ""; const clone = el.cloneNode(true); clone.querySelectorAll(".items-left, span.items-left, .badge").forEach(n => n.remove()); return norm(clone.textContent || ""); }
function isLabelUnavailable(lab) {
  if (!lab) return true;
  const cls = lab.className || ""; if (/\bline-through\b|\btext-muted\b|\bdisabled\b/.test(cls)) return true;
  const badge = lab.parentElement?.querySelector(".items-left, span.items-left"); const t = (badge?.textContent || "").toLowerCase();
  return t.includes("none") || /\b0\s*available\b/.test(t);
}
function pointerSeq(node) {
  if (!node) return false;
  try {
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  } catch { 
    try { 
      node.click(); 
      return true;
    } catch { 
      return false;
    } 
  }
}

function forceCheckboxSelection(checkbox, label, list) {
  let changed = false;
  const before = checkbox.checked;

  // Try multiple selection methods
  const methods = [
    // 1. Natural label click
    () => label && pointerSeq(label),
    // 2. Direct checkbox click
    () => pointerSeq(checkbox),
    // 3. Programmatic check
    () => {
      checkbox.checked = true;
      checkbox.setAttribute('aria-checked', 'true');
      return true;
    }
  ];

  // Try each method until one works
  for (const method of methods) {
    try {
      if (method()) {
        // Verify the change
        if (!checkbox.checked) {
          checkbox.checked = true;
        }
        // Fire events if state changed
        if (checkbox.checked !== before) {
          checkbox.dispatchEvent(new Event('input', { bubbles: true }));
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          list.dispatchEvent(new Event('change', { bubbles: true }));
          changed = true;
          break;
        }
      }
    } catch (e) {
      console.error('Selection method failed:', e);
      continue;
    }
  }

  return { 
    changed: changed || (checkbox.checked !== before),
    picked: checkbox.value || checkbox.id
  };
}

/** MULTI: kept for fallback (not used in main flow) */
function clickWidgetByTokens(tokens = [], root = document) {
  const list = listRoot(root); if (!list) return false;
  const want = (tokens || []).map(t => String(t || '').toLowerCase().trim()).filter(Boolean); if (!want.length) return false;
  let anyChanged = false;

  const W = window.__WIDX__;
  if (W) {
    W.ensure();
    const candidates = new Set();
    for (const tok of want) {
      const ids = W.tokensToIds.get(tok);
      if (ids) for (const id of ids) candidates.add(id);
    }
    const idsToCheck = candidates.size ? Array.from(candidates) : Array.from(W.mapById.keys());
    for (const id of idsToCheck) {
      const rec = W.mapById.get(id);
      if (!rec || !rec.input || rec.input.disabled || isLabelUnavailable(rec.label)) continue;
      if (!want.some(t => rec.text.includes(t) || id.toLowerCase() === t)) continue;
      const before = rec.input.checked;
      try { rec.label.click(); } catch { try { rec.input.click(); } catch { } }
      if (!rec.input.checked) { rec.input.checked = true; rec.input.setAttribute('aria-checked', 'true'); }
      try { rec.input.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
      try { rec.input.dispatchEvent(new Event('change', { bubbles: true })); } catch { }
      if (rec.input.checked !== before) anyChanged = true;
    }
    if (anyChanged) { try { list.dispatchEvent(new Event('change', { bubbles: true })); } catch { } }
    return anyChanged;
  }

  const items = list.querySelectorAll("li.list-item");
  for (const li of items) {
    const input = li.querySelector('input[type="checkbox"][id]'); if (!input) continue;
    const lab = li.querySelector(`label[for="${CSS.escape(input.id)}"]`) || li.querySelector("label.checkbox");
    if (isLabelUnavailable(lab)) continue;
    const val = norm(input.value || ""); const txt = textWithoutBadges(lab); const idSlug = slug(input.id || "");
    const hit = want.some(t => (val && val.includes(t)) || (txt && txt.includes(t)) || (idSlug && idSlug === slug(t)));
    if (!hit) continue;
    const before = input.checked;
    if (!input.checked) {
      try { (lab || input).click(); } catch { try { input.click(); } catch { } }
      if (!input.checked) { input.checked = true; input.setAttribute('aria-checked', 'true'); }
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
      try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch { }
    }
    if (input.checked !== before) anyChanged = true;
  }
  if (anyChanged) { try { list.dispatchEvent(new Event('change', { bubbles: true })); } catch { } }
  return anyChanged;
}

/* ===================== FAST INDEX (IFRAME SIDE) — upgraded ===================== */
(function initWidgetIndex() {
  if (!IS_IFRAME) return;
  if (window.__WIDX__) return;

  // Add performance optimizations
  const W = window.__WIDX__ = {
    version: 0,
    builtAt: 0,
    list: null,
    mapById: new Map(),       // id -> {input,label,text,slug}
    tokensToIds: new Map(),   // token -> Set(id)
    slugToId: new Map(),      // slug -> id
    cachedSelections: new Map(), // Cache previous selections
    lastUpdate: 0,            // Track last update time
    ensure() { 
      const now = Date.now();
      // Only rebuild index if more than 2 seconds have passed
      if (!this.builtAt || (now - this.lastUpdate > 2000)) {
        buildIndex();
        this.lastUpdate = now;
      }
    },
    getList() { 
      if (!this.list) {
        this.list = document.querySelector(LIST_SEL);
        if (this.list) {
          // Pre-index all items on first load
          this.ensure();
        }
      }
      return this.list;
    }
  };

  const normalize = s => String(s || '').toLowerCase().trim();
  const toSlug = s => normalize(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  function stripBadgesFromLabel(lab) {
    if (!lab) return "";
    const clone = lab.cloneNode(true);
    clone.querySelectorAll(".items-left, span.items-left, .badge").forEach(n => n.remove());
    return (clone.textContent || "").toLowerCase().trim();
  }

  function buildIndex() {
    const list = W.getList();
    W.mapById.clear();
    W.tokensToIds.clear();
    W.slugToId.clear();

    if (!list) { W.version++; W.builtAt = Date.now(); return; }

    const labels = list.querySelectorAll('label.checkbox[for]');
    for (const lab of labels) {
      const forId = lab.getAttribute('for');
      const input = document.getElementById(forId);
      if (!input) continue;

      const text = stripBadgesFromLabel(lab);
      const slug = toSlug(forId);

      W.mapById.set(forId, { input, label: lab, text, slug });

      const tokens = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
      tokens.add(text);

      for (const t of tokens) {
        if (!W.tokensToIds.has(t)) W.tokensToIds.set(t, new Set());
        W.tokensToIds.get(t).add(forId);
      }
      if (slug) W.slugToId.set(slug, forId);
    }

    W.version++; W.builtAt = Date.now();
  }

  const kick = () => (window.requestIdleCallback ? requestIdleCallback(buildIndex, { timeout: 200 }) : setTimeout(buildIndex, 0));
  kick();

  const mo = new MutationObserver(() => kick());
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
})();

/** SINGLE: pick first available by priority with O(1) exact-id/slug path */
function clickWidgetFirstAvailable(tokens = [], root = document) {
  const W = window.__WIDX__;
  if (!W) return { changed: false, picked: null };

  const list = W.getList?.() || root.querySelector(LIST_SEL);
  if (!list) return { changed: false, picked: null };

  // Process tokens once
  const tokenSet = new Set(
    (Array.isArray(tokens) ? tokens : [tokens])
      .filter(t => t != null)
      .map(t => String(t).toLowerCase().trim())
      .filter(Boolean)
  );

  if (!tokenSet.size) return { changed: false, picked: null };

  // Fast path: direct lookup
  const checkboxes = list.querySelectorAll('input[type="checkbox"]');
  for (const checkbox of checkboxes) {
    if (checkbox.checked) continue;
    
    const label = checkbox.closest('label') || document.querySelector(`label[for="${checkbox.id}"]`);
    if (!label || isLabelUnavailable(label)) continue;

    const labelText = (label.textContent || '').toLowerCase().trim();
    const value = (checkbox.value || '').toLowerCase().trim();

    // Check for exact matches first
    if ([...tokenSet].some(token => 
      labelText === token || 
      value === token || 
      checkbox.id.toLowerCase() === token
    )) {
      return forceCheckboxSelection(checkbox, label, list);
    }
  }
  if (!tokenSet.size) return { changed: false, picked: null };

  // Fast path: direct match using Map for O(1) lookup
  for (const tok of tokenSet) {
    // Check direct ID match
    const directMatch = W.mapById.get(tok);
    if (directMatch?.input && !directMatch.input.disabled && !isLabelUnavailable(directMatch.label)) {
      return __selectSingle(list, directMatch.input);
    }
    
    // Check slug match
    const slugMatch = W.mapById.get(W.slugToId.get(tok));
    if (slugMatch?.input && !slugMatch.input.disabled && !isLabelUnavailable(slugMatch.label)) {
      return __selectSingle(list, slugMatch.input);
    }
  }

  // Optimized candidate search using Set intersection
  const candidates = new Set();
  let minSize = Infinity;
  let bestTokIds = null;

  // Find the smallest token match set for optimization
  for (const tok of tokenSet) {
    const ids = W.tokensToIds.get(tok);
    if (ids?.size) {
      if (ids.size < minSize) {
        minSize = ids.size;
        bestTokIds = ids;
      }
    }
  }

  // Use the smallest token set as base and check against others
  if (bestTokIds) {
    for (const id of bestTokIds) {
      const rec = W.mapById.get(id);
      if (!rec || !rec.input || rec.input.disabled || isLabelUnavailable(rec.label)) continue;
      if (tokenSet.has(rec.text) || tokenSet.has(rec.slug) || tokenSet.has(id.toLowerCase())) {
        return __selectSingle(list, rec.input);
      }
      candidates.add(id);
    }
  }

  // Fallback to checking all IDs if no candidates found
  if (!candidates.size) {
    for (const id of W.mapById.keys()) {
      const rec = W.mapById.get(id);
      if (!rec || !rec.input || rec.input.disabled || isLabelUnavailable(rec.label)) continue;
      if (tokenSet.has(rec.text) || tokenSet.has(rec.slug) || tokenSet.has(id.toLowerCase())) {
        return __selectSingle(list, rec.input);
      }
    }
  }

  return { changed: false, picked: null };

  function __selectSingle(listEl, targetInput) {
    let changed = false;

    // Uncheck others only if needed
    const checked = listEl.querySelectorAll('input[type="checkbox"][id]:checked');
    for (const i of checked) {
      if (i === targetInput) continue;
      i.checked = false;
      i.setAttribute('aria-checked', 'false');
      changed = true;
    }

    const before = targetInput.checked;
    const lab = targetInput.id ? listEl.querySelector(`label[for="${CSS.escape(targetInput.id)}"]`) : null;
    if (!before) { try { (lab || targetInput).click(); } catch { targetInput.checked = true; } }

    if (!targetInput.checked) {
      targetInput.checked = true;
      targetInput.setAttribute('aria-checked', 'true');
      changed = true;
    } else if (!before) {
      changed = true;
    }

    if (changed) {
      try { targetInput.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
      try { targetInput.dispatchEvent(new Event('change', { bubbles: true })); } catch { }
      try { listEl.dispatchEvent(new Event('change', { bubbles: true })); } catch { }
    }

    return { changed, picked: targetInput.value || targetInput.id };
  }
}

/* ===================== Parent bridge: receive value & unlock NEXT ===================== */
if (IS_PARENT && !window.__JF_PARENT_BRIDGE__) {
  window.__JF_PARENT_BRIDGE__ = true;
  window.addEventListener("message", (ev) => {
    const data = ev.data || {};
    if (data.type !== "JF_WIDGET_VALUE" && data.type !== "JF_WIDGET_VALUE_DIRTY") return;

    const frames = Array.from(document.querySelectorAll(IFRAME_SEL));
    const comp = frames.find(f => f.contentWindow === ev.source)?.closest("li.form-line[data-type='control_widget']");
    if (comp && data.type === "JF_WIDGET_VALUE") {
      const hidden = comp.querySelector("input[type='hidden'], textarea");
      if (hidden) { hidden.value = data.value || (data.values || []).join(", "); try { hidden.dispatchEvent(new Event("input", { bubbles: true })); } catch { } try { hidden.dispatchEvent(new Event("change", { bubbles: true })); } catch { } }
    }

    const card = getActiveCard(); if (!card) return;
    card.querySelectorAll(".jfCard-actionsNotification .form-error-message, .form-button-error").forEach(n => n.remove());
    const next = getNextBtn(card);
    if (next && !__RESOLVING_ERRORS__) {
      next.disabled = false; next.removeAttribute("disabled"); next.removeAttribute("aria-disabled");
      next.classList.remove("disabled", "isDisabled"); next.style.pointerEvents = "";
    }
  }, false);
}

/* ===================== Smart NEXT / Submit ===================== */
function railHasError(qid) { const lbl = qs(`#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`); const item = lbl?.closest('.jfProgress-item'); return !!(item && item.classList.contains('hasError')); }
async function waitCardChange(oldId, { wait = 350 } = {}) { await delay(wait); const cur = getActiveCard(); return !!(cur && cur.id && cur.id !== oldId); }

async function smartNextOrSubmit(card, allowSubmit, tokensForWidget = []) {
  const next = getNextBtn(card); const oldId = card.id || ""; const qid = cardIdToQid(card);

  const guardBackIfOldHasError = async (label = "next") => {
    const moved = await waitCardChange(oldId, { wait: 300 }); if (!moved) return null;
    if (railHasError(qid)) { await gotoCardByQid(qid, { timeout: 2000, poll: 120 }); return null; }
    return label;
  };

  if (next && isVisible(next)) {
    if (isDisabledBtn(next)) { tryAgreeToggles(card); if (isDisabledBtn(next)) return null; }
    if (__RESOLVING_ERRORS__) return null;
    next.scrollIntoView({ block: "center" }); next.click();

    const g = await guardBackIfOldHasError("next"); if (g) return g;

    if (hasWidgetInCard(card) && hasLineErrorInCard(card)) {
      await nudgeWidgetDirtyInCard(card);
      await waitCardCleanFast(card, { timeout: T.cardCleanTimeout });
      await waitRailClearedFast(qid, { timeout: T.railTimeout });

      if (isDisabledBtn(next)) tryAgreeToggles(card);
      next.click();
      const g2 = await guardBackIfOldHasError("next"); if (g2) return g2;
    }
    return null;
  }

  if (allowSubmit) {
    if (collectErrorQids().length) return null;
    const submit = card.querySelector("button[class*='form-submit-button']") || document.querySelector("button[class*='form-submit-button']");
    if (submit && isVisible(submit) && !isDisabledBtn(submit)) {
      submit.scrollIntoView({ block: "center" }); submit.click();
      const moved = await waitCardChange(oldId, { wait: 300 });
      if (moved && railHasError(qid)) { await gotoCardByQid(qid, { timeout: 2000, poll: 120 }); return null; }
      return "submitted";
    }
  }
  return null;
}

/* ===================== SINGLE IFRAME LISTENER (merged) ===================== */
if (IS_IFRAME && !window.__JF_IFRAME_READY__) {
  window.__JF_IFRAME_READY__ = true;
  window.addEventListener("message", async (ev) => {
    const data = ev.data || {};

    if (data.type === "JF_WIDGET_PING") {
      try { ev.source.postMessage({ type: "JF_WIDGET_PONG" }, ev.origin || "*"); } catch { }
      return;
    }

    if (data.type === "JF_WIDGET_SELECT") {
      // Use a shorter timeout for widget ready check
      const readyTimeout = new Promise(resolve => setTimeout(() => resolve(false), 2000));
      const widgetReady = Promise.race([waitWidgetReady(2000), readyTimeout]);
      
      if (!await widgetReady) {
        try { ev.source.postMessage({ type: "JF_WIDGET_SELECTED", changed: false, picked: null }, ev.origin || "*"); } catch { }
        return;
      }

      let changed = false, picked = null;
      
      // Optimize selection based on type
      if (data.single) {
        const r = clickWidgetFirstAvailable(data.tokens || [], document);
        changed = !!r.changed; 
        picked = r.picked;
      } else {
        changed = clickWidgetByTokens(data.tokens || [], document);
      }

      // Batch DOM operations and events
      const list = listRoot(document);
      if (list) {
        const values = Array.from(list.querySelectorAll('input[type="checkbox"][id]:checked'))
          .map(i => (i.value || i.id || '').trim());

        // Batch multiple messages into one
        const response = {
          type: "JF_WIDGET_BATCH",
          payload: {
            selected: { changed, picked },
            value: { values, valueStr: values.join(', ') },
            dirty: true
          }
        };

        try { 
          ev.source.postMessage(response, ev.origin || '*');
          list.dispatchEvent(new Event("change", { bubbles: true }));
        } catch { }
      }
      return;
    }

    if (data.type === "JF_WIDGET_RESOLVE" && (data.mode === "clear-invalid" || !data.mode)) {
      await waitWidgetReady(4000);
      const list = listRoot(document); let fixed = false;
      if (list) {
        const checked = Array.from(list.querySelectorAll('input[type="checkbox"][id]:checked'));
        for (const input of checked) {
          const lab = labelFor(input, document);
          if (!isLabelUnavailable(lab)) continue;
          try { pointerSeq(lab || input); } catch { }
          try { (lab || input).click(); } catch { }
          await delay(40);
          if (input.checked) {
            try { input.checked = false; input.setAttribute('aria-checked', 'false'); } catch { }
            try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch { }
            try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch { }
          }
          if (!input.checked) fixed = true;
        }
        if (fixed) {
          try { list.dispatchEvent(new Event('change', { bubbles: true })); } catch { }
        }
      }
      const values = Array.from(list?.querySelectorAll('input[type="checkbox"][id]:checked') || []).map(i => (i.value || i.id || '').trim());
      try { ev.source.postMessage({ type: 'JF_WIDGET_VALUE', values, value: values.join(', ') }, ev.origin || '*'); } catch { }
      try { ev.source.postMessage({ type: 'JF_WIDGET_VALUE_DIRTY' }, ev.origin || '*'); } catch { }
      try { ev.source.postMessage({ type: 'JF_WIDGET_RESOLVED', fixed }, ev.origin || '*'); } catch { }
      return;
    }
  }, false);
}

/* ===================== IFRAME: ultra-fast handler using dedicated port ===================== */
if (IS_IFRAME && !window.__JF_IFRAME_FAST_SELECT__) {
  window.__JF_IFRAME_FAST_SELECT__ = true;

  const quickReady = () => !!document.querySelector(LIST_SEL);

  window.addEventListener("message", (ev) => {
    const data = ev.data || {};
    if (data.type !== "JF_WIDGET_SELECT_FAST") return;

    const port = ev.ports && ev.ports[0];
    if (!port) return;

    const doSelect = () => {
      const r = clickWidgetFirstAvailable(data.tokens || [], document);
      const list = listRoot(document);
      const values = Array.from(list?.querySelectorAll('input[type="checkbox"][id]:checked') || [])
        .map(i => (i.value || i.id || '').trim());
      try { port.postMessage({ type: "JF_WIDGET_SELECTED", changed: !!r.changed, picked: r.picked ?? null, values }); } catch { }
    };

    if (quickReady()) doSelect();
    else setTimeout(doSelect, 0); // micro-yield
  }, false);
}

/* ===== Observer-based wait helpers ===== */
function getRailEl() { return qs('#cardProgress'); }
function buildStateSig() {
  const card = getActiveCard(); if (!card) return 'nocard';
  const qid = cardIdToQid(card) || 'x'; const next = getNextBtn(card); const disabled = isDisabledBtn(next) ? 1 : 0;
  const hasErr = !!(getRailEl()?.querySelector('.jfProgress-item.hasError') ||
    card.querySelector('li.form-line-error, .form-line.form-validation-error, [aria-invalid="true"]') ||
    card.classList.contains('animate-shake'));
  return `${qid}|${disabled}|${hasErr ? 1 : 0}`;
}

async function rescueCurrentCard(
  tokensForWidget = [],
  enabledDaysSet = null,
  includeSpecialEvent = false
) {
  const card = getActiveCard(); if (!card) return false;

  if (hasWidgetInCard(card) && shouldTickCard(card, enabledDaysSet, includeSpecialEvent)) {
    await selectWidgetOptionsInCard(card, tokensForWidget, 900, { single: true });
    // Only one of these is needed; keep the clearer path:
    await clearInvalidAndUnlockNext(card, 900, { unlock: true });
    await waitCardCleanFast(card, { timeout: T.cardCleanTimeout });
    await waitRailClearedFast(cardIdToQid(card), { timeout: T.railTimeout });
  }

  tryAgreeToggles(card);
  const moved = await smartNextOrSubmit(card, false, tokensForWidget);
  return moved === 'next';
}

async function hardResetActiveCard() { const card = getActiveCard(); if (!card) return; const qid = cardIdToQid(card); const lbl = qs(`#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`); lbl?.closest('.jfProgress-item')?.click(); await delay(140); }
function nextFrame() { return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }
function waitWithObserver(target, { predicate, timeout = 2000 }) {
  return new Promise(resolve => {
    if (!target) return resolve(false); if (predicate?.()) return resolve(true);
    const obs = new MutationObserver(() => { if (predicate?.()) { obs.disconnect(); resolve(true); } }); obs.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-invalid'] });
    setTimeout(() => { obs.disconnect(); resolve(predicate?.() || false); }, timeout);
  });
}
async function waitCardCleanFast(card, { timeout = 1200 } = {}) { const ok = () => !(card.querySelector('li.form-line-error, .form-line.form-validation-error, li[aria-invalid="true"]') || card.classList.contains('animate-shake') || card.querySelector('.jfCard.animate-shake')); const res = await waitWithObserver(card, { predicate: ok, timeout }); if (!res) return ok(); await nextFrame(); return true; }
async function waitRailClearedFast(qid, { timeout = 1800 } = {}) { const lbl = qs(`#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`); const item = lbl?.closest('.jfProgress-item'); const ok = () => !railHasError(qid); const res = await waitWithObserver(item || document.body, { predicate: ok, timeout }); if (!res) return ok(); await nextFrame(); return true; }

/* ===================== Submit-error resolver (multi-pass) ===================== */
// Error resolution cache
const errorResolutionCache = new Map();

async function resolveErrorsOnCard(
  tokensForWidget = [],
  { advance = false, enabledDaysSet = null, includeSpecialEvent = false } = {}
) {
  const card = getActiveCard(); if (!card) return false;
  const qid = cardIdToQid(card);

  // Check cache for previous error resolution
  const cacheKey = `${qid}-${tokensForWidget.join(',')}`;
  if (errorResolutionCache.has(cacheKey)) {
    const cachedResolution = errorResolutionCache.get(cacheKey);
    if (cachedResolution.success) {
      return true;
    }
  }

  const railHas = collectErrorQids().indexOf(qid) !== -1;
  if (hasWidgetInCard(card) && (hasLineErrorInCard(card) || railHas)) {
    // Single attempt with shorter timeout
    const ok = await clearInvalidAndUnlockNext(card, 300, { unlock: true });
    
    if (shouldTickCard(card, enabledDaysSet, includeSpecialEvent)) {
      const sel = await selectWidgetOptionsInCard(card, tokensForWidget, 300, { single: true });
      if (!sel.picked) {
        const moved = await smartNextOrSubmit(card, false, tokensForWidget);
        errorResolutionCache.set(cacheKey, { success: moved === 'next' });
        return moved === 'next';
      }
      
      // Reduced timeouts
      await Promise.all([
        waitCardCleanFast(card, { timeout: 300 }),
        waitRailClearedFast(qid, { timeout: 400 })
      ]);
      
      errorResolutionCache.set(cacheKey, { success: true });
    }
  }

  tryAgreeToggles(card);
  if (!advance) return true;
  const res = await smartNextOrSubmit(card, false, tokensForWidget);
  return res === 'next';
}

async function handleSubmitErrors({
  tokensForWidget = [],
  maxLoops = 6,
  waitForQidsMs = 3000,
  enabledDaysSet = null,
  includeSpecialEvent = false
} = {}) {
  const waitIds = async () => { const t0 = Date.now(); let ids = collectErrorQids(); while (!ids.length && Date.now() - t0 < waitForQidsMs) { await delay(120); ids = collectErrorQids(); } return ids; };

  __RESOLVING_ERRORS__ = true;
  try {
    let prevCount = Infinity, noProgress = 0;
    for (let loop = 0; loop < maxLoops; loop++) {
      const qids = await waitIds(); if (!qids.length) break;
      for (const qid of qids) {
        await gotoCardByQid(qid, { timeout: 3000, poll: 100 }); await delay(60);
        await resolveErrorsOnCard(tokensForWidget, { advance: true, enabledDaysSet, includeSpecialEvent });
        await waitRailClearedFast(qid, { timeout: 1600 });
        const cur = getActiveCard(); if (cur && cardIdToQid(cur) === qid) { await waitCardCleanFast(cur, { timeout: 1000 }); }
        await nextFrame();
      }
      const now = collectErrorQids().length; if (now === 0) break;
      if (now >= prevCount) { noProgress++; if (noProgress >= 2) break; } else { noProgress = 0; }
      prevCount = now;
    }
    return collectErrorQids().length;
  } finally { __RESOLVING_ERRORS__ = false; }
}

/* ===================== Main loop (parent) ===================== */
// Performance optimization caches
const processedCards = new Set();
const cardStateCache = new Map();

async function mainLoop(payload) {
  // Reduced default delay
  const delayTime = Number(payload.delayTime) || 100;
  const allowSubmit = !!payload.submitForm;

  const year = Number(payload.year), month = Number(payload.month), day = Number(payload.day);

  // Process input arrays and ensure proper token handling
  const inputTxtArr = Array.isArray(payload.inputTxtArr) ? payload.inputTxtArr : [];
  const checkboxTxtArr = Array.isArray(payload.checkboxTxtArr) ? payload.checkboxTxtArr : [];
  
  // Ensure proper token handling for widgets and radio buttons
  const tokensForWidget = Array.from(new Set(
    (Array.isArray(checkboxTxtArr) ? checkboxTxtArr.flat() : [checkboxTxtArr])
      .filter(t => t != null)
      .map(t => String(t).toLowerCase().trim())
      .filter(Boolean)
  ));

  // Pre-compute enabled days for faster checks
  const enabledDaysSource = payload.enabledDays ?? payload.enableddays ?? payload.enabled_days ?? [];
  const enabledDaysSet = buildEnableDaysSet(enabledDaysSource);
  const includeSpecialEvent = !!(payload.includeSpecialEvent ?? payload.includeSpecialDay);

  const widgetSentForCard = new Set();

  let started = false, lastCardId = "", lastSubmitQid = null, lastSig = "", lastSigAt = Date.now(), rescueFails = 0;

  while (window.isFilling) {
    await delay(delayTime);

    if (!started) {
      const startBtn = qs("#jfCard-welcome-start");
      if (startBtn?.checkVisibility?.() || isVisible(startBtn)) { startBtn.click(); started = true; }
    }

    const card = getActiveCard(); if (!card) continue;

    const hasSubmitHere = !!(card.querySelector("button[class*='form-submit-button']") || document.querySelector("button[class*='form-submit-button']"));
    if (hasSubmitHere && allowSubmit && collectErrorQids().length) {
      await handleSubmitErrors({ tokensForWidget, maxLoops: 6, waitForQidsMs: 3000, enabledDaysSet, includeSpecialEvent });
      await delay(80);
      continue;
    }
    if (hasSubmitHere) lastSubmitQid = cardIdToQid(card);

    // watchdog
    if (__WATCHDOG_ENABLED__) {
      const sig = buildStateSig();
      if (sig === lastSig) {
        if (Date.now() - lastSigAt > T.stuckSameSig && !__RESOLVING_ERRORS__) {
          const ok = await rescueCurrentCard(tokensForWidget, enabledDaysSet, includeSpecialEvent);
          lastSigAt = Date.now();
          if (!ok) { rescueFails++; if (rescueFails >= T.hardResetAfter) { await hardResetActiveCard(); rescueFails = 0; } }
          else rescueFails = 0;
          await delay(T.tick); continue;
        }
      } else { lastSig = sig; lastSigAt = Date.now(); rescueFails = 0; }
    }

    const cardId = card.id || "";
    if (cardId === lastCardId) {
      if (hasWidgetInCard(card) && hasLineErrorInCard(card)) { await nudgeWidgetDirtyInCard(card); }
      if (__RESOLVING_ERRORS__) { await delay(80); continue; }
      const act0 = await smartNextOrSubmit(card, allowSubmit, tokensForWidget);
      if (act0 === "next" || act0 === "submitted") {
        if (act0 === "submitted") { await delay(40); await waitErrorsReady({ timeout: T.errorsWaitMax, poll: 120 }); }
        if (act0 === "submitted" && !hasValidationErrors() && collectErrorQids().length === 0) { window.isFilling = false; break; }
        if (act0 === "submitted") {
          const stepped = await stepIntoErrorViaPrev({ tokensForWidget, warmup: 250, enabledDaysSet, includeSpecialEvent }); if (stepped) { await delay(delayTime); continue; }
          const remaining = await handleSubmitErrors({ tokensForWidget, maxLoops: 3, waitForQidsMs: 8000, enabledDaysSet, includeSpecialEvent });
          if (remaining === 0 && lastSubmitQid) {
            await gotoCardByQid(lastSubmitQid); await delay(240);
            const submitCard = getActiveCard(); submitCard?.querySelector("button[class*='form-submit-button']")?.click();
            await waitErrorsReady({ timeout: T.errorsWaitMax, poll: 120 });
            if (!hasValidationErrors() && collectErrorQids().length === 0) { window.isFilling = false; break; }
          }
        }
        await delay(delayTime); continue;
      }
      continue;
    }

    // new card
    lastCardId = cardId;

    // ==== Autofill per field
    const fieldId = (card.id || "").replace("cid_", "");
    const comps = qsa("[data-type]", card);
    for (const comp of comps) {
      const type = comp.getAttribute("data-type");
      switch (type) {
        case "first": fillInto(comp, "first", payload.firstName); break;
        case "last": fillInto(comp, "last", payload.lastName); break;
        case "email": fillInto(comp, "email", payload.email); break;
        case "control_phone":
        case "mask-number": await fillMaskedPhone(comp, payload.phone); break;
        case "control_datetime":
        case "control_date":
        case "liteDate": setLiteDate(fieldId, year, month, day); break;
        case "input-textbox": {
          const input = comp;
          const label =
            input.labels?.[0]?.querySelector(".jsQuestionLabelContainer")?.textContent?.trim() ||
            document.getElementById(input.getAttribute("aria-labelledby"))?.querySelector(".jsQuestionLabelContainer")?.textContent?.trim() ||
            document.querySelector(`label[for="${CSS.escape(input.id)}"] .jsQuestionLabelContainer`)?.textContent?.trim() || "";
          const map = inputTxtArr.find(m => (m.text || []).some(t => (label || "").toLowerCase().includes(String(t).toLowerCase())));
          if (map) { input.value = map.value; try { input.dispatchEvent(new Event("input", { bubbles: true })); } catch { } }
          break;
        }
        case "control_radio": {
          const labelText = getFieldLabelText(comp);
          const tks = tokensForWidget;
          if (isConsentGroup(labelText) || (tks.length && tks.some(t => labelText.toLowerCase().includes(String(t).toLowerCase())))) selectRadioAgree(comp, tks);
          break;
        }
        case "control_checkbox": {
          const boxes = comp.querySelectorAll("input[type='checkbox']");
          if (boxes.length === 1) {
            const labelText = getFieldLabelText(comp);
            if (isConsentGroup(labelText) && !boxes[0].checked) { boxes[0].click(); try { boxes[0].dispatchEvent(new Event("change", { bubbles: true })); } catch { } }
          }
          break;
        }
        default: break;
      }
    }

    // ==== Widget select — Optimized SINGLE priority selection
    if (tokensForWidget.length && hasWidgetInCard(card) && !widgetSentForCard.has(card.id)) {
      if (!shouldTickCard(card, enabledDaysSet, includeSpecialEvent)) {
        widgetSentForCard.add(card.id);
      } else {
        // Try selection with shorter timeout first
        const result = await selectWidgetOptionsInCard(card, tokensForWidget, 150, { single: true });
        if (!result?.picked) {
          // If fast attempt fails, try one more time with slightly longer timeout
          await selectWidgetOptionsInCard(card, tokensForWidget, 300, { single: true });
        }
        widgetSentForCard.add(card.id);
      }
    }

    // ==== Next / Submit
    const act = await smartNextOrSubmit(card, allowSubmit, tokensForWidget);
    if (act === "next") { await delay(delayTime); continue; }
    if (act === "submitted") {
      await delay(40); await waitErrorsReady({ timeout: T.errorsWaitMax, poll: 120 });
      if (!hasValidationErrors() && collectErrorQids().length === 0) { window.isFilling = false; break; }
      const remaining = await handleSubmitErrors({ tokensForWidget, maxLoops: 3, waitForQidsMs: 3500, enabledDaysSet, includeSpecialEvent });
      if (remaining === 0 && lastSubmitQid) {
        await gotoCardByQid(lastSubmitQid); await delay(200);
        const submitCard = getActiveCard(); submitCard?.querySelector("button[class*='form-submit-button']")?.click();
        await waitErrorsReady({ timeout: T.errorsWaitMax, poll: 120 });
        if (!hasValidationErrors() && collectErrorQids().length === 0) { window.isFilling = false; break; }
      }
      continue;
    }
  }
}

/* ===================== Step into previous error card (optional tick) ===================== */
async function stepIntoErrorViaPrev({
  tokensForWidget = [],
  warmup = 250,
  enabledDaysSet = null,
  includeSpecialEvent = false
} = {}) {
  const active = qs('#cardProgress .jfProgress-item.isActive');
  const prev = active?.previousElementSibling; if (!prev) return false;

  prev.scrollIntoView({ block: 'center' }); prev.click();
  await delay(warmup);

  const card = getActiveCard(); if (!card) return false;

  if (tokensForWidget.length && hasWidgetInCard(card) &&
    shouldTickCard(card, enabledDaysSet, includeSpecialEvent)) {
    await selectWidgetOptionsInCard(card, tokensForWidget, 900, { single: true });
    await delay(100);
  }

  const act = await smartNextOrSubmit(card, false, tokensForWidget);
  return act === 'next';
}

/* ===================== Boot ===================== */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "stopFilling") { window.isFilling = false; __RESOLVING_ERRORS__ = false; sendResponse({ ok: true }); return false; }
  if (msg.action !== "startFilling") return;
  window.isFilling = true;
  if (IS_PARENT) { Promise.resolve().then(() => mainLoop(msg.data || {})); }
  sendResponse({ ok: true }); return false;
});
