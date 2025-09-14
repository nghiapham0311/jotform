/* Converted & cleaned JavaScript */
const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const IS_PARENT = location.host === "form.jotform.com";
const IS_IFRAME = /\.jotform\.io$/i.test(location.host);

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ---- postMessage security helpers ---- */
const PARENT_ALLOWED_ORIGINS = ["https://form.jotform.com"];
const IFRAME_ALLOWED_ORIGINS = [
  /^https:\/\/([a-z0-9-]+\.)?app-widgets\.jotform\.io$/i,
  /^https:\/\/([a-z0-9-]+\.)?widgets\.jotform\.io$/i,
];

function originAllowed(origin, allowList) {
  if (!origin) return false;
  try {
    const o = new URL(origin).origin;
    return allowList.some((p) => (p instanceof RegExp ? p.test(o) : p === o));
  } catch {
    return false;
  }
}

function isVisible(el) {
  if (!el) return false;
  const cs = getComputedStyle(el);
  if (el.hidden || cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
  if ((el.offsetWidth | 0) === 0 && (el.offsetHeight | 0) === 0 && el.getClientRects().length === 0) return false;
  if (el.offsetParent === null && cs.position !== "fixed") return false;
  return true;
}

function isDisabledBtn(btn) {
  if (!btn) return true;
  if (btn.disabled || btn.matches?.(":disabled")) return true;
  const aria = btn.getAttribute("aria-disabled");
  if (aria && aria !== "false") return true;
  if (/\bdisabled\b/i.test(btn.className) || /\bisDisabled\b/.test(btn.className)) return true;
  return getComputedStyle(btn).pointerEvents === "none";
}

function getActiveCard() {
  const cards = qsa(".jfCard-wrapper.isVisible");
  return cards.length ? cards[cards.length - 1] : null;
}

function cardIdToQid(card) {
  return (card?.id || "").replace("cid_", "");
}

/* ===================== Generic fillers ===================== */

function fillInto(comp, part, val) {
  if (val == null || val === "") return false;
  const el =
    comp.querySelector(`input[data-component='${part}']`) ||
    comp.querySelector(`input[name*='[${part}]' i]`) ||
    comp.querySelector("input");
  if (!el) return false;
  if ((el.value || "") === String(val)) return true;
  el.focus();
  el.value = String(val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
  return true;
}

const digitsOnly = (s) => String(s || "").replace(/\D+/g, "");

function setValueWithEvents(el, val) {
  if (!el) return;
  el.focus();
  try {
    el.setSelectionRange(0, (el.value || "").length);
    el.setRangeText("", 0, (el.value || "").length, "end");
  } catch { }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.value = val;
  try {
    el.setSelectionRange(String(val).length, String(val).length);
  } catch { }
  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      inputType: "insertFromPaste",
      data: String(val),
    })
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

async function fillMaskedPhone(comp, phoneStr) {
  const digits = digitsOnly(phoneStr);
  if (!digits) return false;

  let el = comp.querySelector("input[id$='_full'][data-type='mask-number'], input.mask-phone-number, input.forPhone");
  if (el) {
    setValueWithEvents(el, digits);
    return true;
  }

  el = comp.querySelector(".iti .iti__tel-input, .iti input[type='tel']");
  if (el) {
    setValueWithEvents(el, digits);
    return true;
  }

  const parts = qsa(
    "input[data-component='area'], input[data-component='phone'], input[type='tel'][name*='area' i], input[type='tel'][name*='phone' i]",
    comp
  );
  if (parts.length >= 2) {
    const [a, b, c] = parts;
    const la = a.maxLength || 3,
      lb = b.maxLength || (c ? 3 : digits.length - la),
      lc = c?.maxLength || 4;
    setValueWithEvents(a, digits.slice(0, la));
    setValueWithEvents(b, digits.slice(la, la + lb));
    if (c) setValueWithEvents(c, digits.slice(la + lb, la + lb + lc));
    return true;
  }

  el = comp.querySelector("input[type='tel']");
  if (el) {
    setValueWithEvents(el, digits);
    return true;
  }
  return false;
}

function setLiteDate(fieldId, y, m, d) {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const field = qs(`#lite_mode_${fieldId}`);
  if (!field) return false;
  const sep = field.getAttribute("data-seperator") || field.getAttribute("seperator") || "/";
  const fmt = field.getAttribute("data-format") || field.getAttribute("format") || "mmddyyyy";

  let text = `${mm}${sep}${dd}${sep}${y}`;
  if (fmt === "ddmmyyyy") text = `${dd}${sep}${mm}${sep}${y}`;
  if (fmt === "yyyymmdd") text = `${y}${sep}${mm}${sep}${dd}`;
  field.value = text;

  const iso = qs(`#input_${fieldId}`);
  if (iso) iso.value = `${y}-${mm}-${dd}`;

  const ev = document.createEvent("HTMLEvents");
  ev.initEvent("dataavailable", true, true);
  ev.eventName = "date:changed";
  qs(`#id_${fieldId}`)?.dispatchEvent(ev);
  return true;
}

/* ===================== Consent helpers ===================== */

function getFieldLabelText(comp) {
  const input = comp.querySelector("input, textarea, select");
  const ariaIds = (input?.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .filter(Boolean);
  const pieces = ariaIds.map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "");
  let text = pieces.join(" ").trim();
  if (!text) {
    const container = comp.closest("li[id^='id_'], [data-type]") || comp;
    const labelEl =
      container.querySelector(".jfQuestion-label, .jf-question-label, .form-label") ||
      container.querySelector("[id^='label_']") ||
      container.querySelector("label");
    if (labelEl) text = (labelEl.innerText || labelEl.textContent || "").trim();
  }
  return text.replace(/\*\s*$/, "").replace(/\bThis field is required\.?$/i, "").replace(/\s+/g, " ").trim();
}

function isConsentGroup(labelText) {
  const s = (labelText || "").toLowerCase();
  return /\bagree|accept|consent|terms|policy|privacy|understand|acknowledge|yes\b/.test(s);
}

function getRadioOptions(comp) {
  return qsa("input[type='radio']", comp).map((input) => {
    let txt = "";
    const wrap = input.closest("label");
    if (wrap) {
      const t = wrap.querySelector(".jfRadio-labelText") || wrap;
      txt = (t.innerText || t.textContent || "").trim();
    } else {
      const lab = comp.querySelector(`label[for='${input.id}']`);
      const t = lab?.querySelector(".jfRadio-labelText") || lab;
      if (t) txt = (t.innerText || t.textContent || "").trim();
    }
    return { input, text: txt, value: (input.value || "").trim() };
  });
}

function selectRadioAgree(comp, tokens = []) {
  const opts = getRadioOptions(comp);
  if (!opts.length) return false;
  const tks = (tokens || []).map((t) => String(t).toLowerCase()).filter(Boolean);
  const syn = ["agree", "i agree", "accept", "i accept", "consent", "yes", "ok", "okay", "i understand", "understand", "acknowledge"];
  const hit = opts.find((o) => {
    const tx = o.text.toLowerCase(),
      vv = o.value.toLowerCase();
    return (tks.length && tks.some((t) => tx.includes(t) || vv.includes(t))) || syn.some((t) => tx.includes(t) || vv.includes(t));
  });
  if (!hit) return false;
  if (!hit.input.checked) {
    hit.input.click();
    hit.input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
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
  const keys = ["agree", "accept", "consent", "i understand", "understand", "acknowledge", "terms", "policy", "privacy", "yes", "ok", "okay"];
  let changed = false;
  for (const el of inputs) {
    const txt = getTxt(el);
    if (keys.some((k) => txt.includes(k)) && !el.checked) {
      el.click();
      el.dispatchEvent(new Event("change", { bubbles: true }));
      changed = true;
    }
  }
  return changed;
}

/* ===================== Nav helpers ===================== */

function hasValidationErrors() {
  return !!(
    document.querySelector("#cardProgress .jfProgress-item.hasError, #cardProgress .jfProgress-item.isInvalid, #cardProgress .jfProgress-item.-error") ||
    document.querySelector(".form-button-error, .jfCard-actionsNotification .form-error-message, .jfErrorMessage, .error-message") ||
    document.querySelector("li.form-line-error, .form-line.form-validation-error, li.form-line[aria-invalid='true']") ||
    document.querySelector("[aria-invalid='true']")
  );
}

function unlockNext(next) {
  if (!next) return;
  next.disabled = false;
  next.removeAttribute("disabled");
  next.removeAttribute("aria-disabled");
  next.classList.remove("disabled", "isDisabled");
  next.style.pointerEvents = "";
  document.dispatchEvent(new Event("input", { bubbles: true }));
  document.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitEnabled(btn, ms = 1200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await delay(120);
    if (btn && !isDisabledBtn(btn)) return true;
  }
  return false;
}

function getNextBtn(card) {
  return (
    card.querySelector("button[data-testid^='nextButton_']") ||
    card.querySelector("button.form-pagebreak-next") ||
    card.querySelector("button[name='next']")
  );
}

/* ===================== Widget (parent) helpers ===================== */

function getWidgetComponents(card) {
  if (!card) return [];
  let items = qsa("li.form-line[data-type='control_widget']", card).filter(isVisible);
  if (!items.length) {
    const li = card.closest("li.form-line[data-type='control_widget']");
    if (li && isVisible(li)) items = [li];
  }
  return items;
}
const hasWidgetInCard = (card) => getWidgetComponents(card).length > 0;

function findWidgetIframeInComp(comp) {
  const sel = [
    "iframe.custom-field-frame",
    "iframe[id^='customFieldFrame_']",
    "iframe[src*='app-widgets.jotform.io']",
    "iframe[src*='widgets.jotform.io']",
  ].join(",");
  const ifr = comp.querySelector(sel);
  return ifr && isVisible(ifr) ? ifr : null;
}

function waitForWidgetIframeInComp(comp, { appearTimeout = 4000, loadTimeout = 4000 } = {}) {
  return new Promise((resolve) => {
    const ready = () => {
      const ifr = findWidgetIframeInComp(comp);
      if (!ifr) return null;
      return ifr;
    };
    const now = ready();
    if (now) {
      if (now.contentDocument?.readyState === "complete") {
        resolve(now);
        return;
      }
      const onLoad = () => {
        now.removeEventListener("load", onLoad);
        resolve(now);
      };
      now.addEventListener("load", onLoad, { once: true });
      setTimeout(() => {
        now.removeEventListener("load", onLoad);
        resolve(now);
      }, loadTimeout);
      return;
    }
    const kill = setTimeout(() => {
      obs.disconnect();
      resolve(null);
    }, appearTimeout);
    const obs = new MutationObserver(() => {
      const ifr = ready();
      if (!ifr) return;
      clearTimeout(kill);
      obs.disconnect();
      if (ifr.contentDocument?.readyState === "complete") {
        resolve(ifr);
        return;
      }
      const onLoad = () => {
        ifr.removeEventListener("load", onLoad);
        resolve(ifr);
      };
      ifr.addEventListener("load", onLoad, { once: true });
      setTimeout(() => {
        ifr.removeEventListener("load", onLoad);
        resolve(ifr);
      }, loadTimeout);
    });
    obs.observe(comp, { childList: true, subtree: true });
  });
}

async function selectWidgetOptionsInCard(card, tokens = [], timeout = 4500) {
  const comps = getWidgetComponents(card);
  if (!comps.length || !tokens?.length) return false;
  let changed = false;
  for (const comp of comps) {
    const iframe = await waitForWidgetIframeInComp(comp, { appearTimeout: 1500, loadTimeout: 1500 });
    if (!iframe) continue;
    const win = iframe.contentWindow;
    const origin = iframe.src ? new URL(iframe.src).origin : "*";
    let done = false;
    const onMsg = (ev) => {
      if (ev.source !== win) return;
      const data = ev.data || {};
      if (data.type === "JF_WIDGET_PONG") {
        try {
          win.postMessage({ type: "JF_WIDGET_SELECT", tokens }, origin);
        } catch { }
      }
      if (data.type === "JF_WIDGET_SELECTED") {
        changed = changed || !!data.changed;
        done = true;
        window.removeEventListener("message", onMsg);
      }
    };
    window.addEventListener("message", onMsg);
    try {
      win.postMessage({ type: "JF_WIDGET_PING" }, origin);
    } catch { }
    const t0 = Date.now();
    while (!done && Date.now() - t0 < timeout) {
      await delay(300);
      try {
        win.postMessage({ type: "JF_WIDGET_PING" }, origin);
      } catch { }
    }
    window.removeEventListener("message", onMsg);
  }
  return changed;
}

async function resolveWidgetErrorInCard(card, tokens = [], timeout = 4500) {
  const comps = getWidgetComponents(card);
  if (!comps.length) return false;
  let fixed = false;
  for (const comp of comps) {
    const iframe = await waitForWidgetIframeInComp(comp, { appearTimeout: 1500, loadTimeout: 1500 });
    if (!iframe) continue;
    const win = iframe.contentWindow;
    const origin = iframe.src ? new URL(iframe.src).origin : "*";
    let done = false,
      sawPong = false,
      gotDirty = false;
    const onMsg = (ev) => {
      if (ev.source !== win) return;
      if (!originAllowed(ev.origin, PARENT_ALLOWED_ORIGINS)) return;
      const data = ev.data || {};
      if (data.type === "JF_WIDGET_PONG") sawPong = true;
      if (data.type === "JF_WIDGET_VALUE_DIRTY") gotDirty = true;
      if (data.type === "JF_WIDGET_RESOLVED") {
        fixed = fixed || !!data.fixed;
        done = true;
        window.removeEventListener("message", onMsg);
      }
    };
    window.addEventListener("message", onMsg);
    const t0 = Date.now();
    while (!sawPong && Date.now() - t0 < timeout) {
      try {
        win.postMessage({ type: "JF_WIDGET_PING" }, origin);
      } catch { }
      await delay(150);
    }
    const t1 = Date.now();
    while (!done && Date.now() - t1 < timeout) {
      try {
        win.postMessage({ type: "JF_WIDGET_RESOLVE", tokens }, origin);
      } catch { }
      await delay(200);
    }
    window.removeEventListener("message", onMsg);
    if (gotDirty || fixed) {
      const hidden = comp.querySelector("input[type='hidden'], textarea");
      hidden?.dispatchEvent(new Event("input", { bubbles: true }));
      hidden?.dispatchEvent(new Event("change", { bubbles: true }));
      card.querySelectorAll(".jfCard-actionsNotification .form-error-message, .form-button-error").forEach((n) => n.remove());
      document.dispatchEvent(new Event("input", { bubbles: true }));
      document.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  if (fixed) {
    await delay(300);
    document.dispatchEvent(new Event("input", { bubbles: true }));
    document.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return fixed;
}

function hasWidgetOutOfStockError(card) {
  const msg = card.querySelector(".jfCard-actionsNotification .form-error-message, .form-button-error");
  const t = (msg?.textContent || "").toLowerCase();
  return /\brun out\b|\bjust run out\b|\bout of stock\b/.test(t);
}

/* ===================== Iframe logic (click by input.value) ===================== */

function waitWidgetReady(maxTime = 5000) {
  return new Promise((resolve) => {
    const ok = () =>
      document.querySelector("#gr_list label.checkbox, #checklist label.checkbox, ul.checklist label.checkbox, ul.checklist input[type='checkbox']");
    if (ok()) {
      resolve(true);
      return;
    }
    const obs = new MutationObserver(() => {
      if (ok()) {
        obs.disconnect();
        resolve(true);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      obs.disconnect();
      resolve(!!ok());
    }, maxTime);
  });
}

function pointerSeq(node) {
  if (!node) return;
  const o = { bubbles: true, cancelable: true, view: window };
  node.dispatchEvent(new MouseEvent("pointerdown", o));
  node.dispatchEvent(new MouseEvent("mousedown", o));
  node.dispatchEvent(new MouseEvent("mouseup", o));
  node.dispatchEvent(new MouseEvent("click", o));
  node.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  node.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
}

function getList(root = document) {
  return root.querySelector("#gr_list, #checklist, ul.checklist");
}

function labelFor(input, root = document) {
  return input?.id ? root.querySelector(`label[for='${CSS.escape(input.id)}']`) : null;
}

function textWithoutBadges(el) {
  if (!el) return "";
  const clone = el.cloneNode(true);
  clone.querySelectorAll(".items-left, span.items-left, .badge").forEach((n) => n.remove());
  return norm(clone.textContent || "");
}

function isUnavailable(input, label) {
  if (input?.disabled) return true;
  const cls = label?.className || "";
  if (/\bline-through\b|\btext-muted\b|\bdisabled\b/.test(cls)) return true;
  const badge = label?.parentElement?.querySelector(".items-left, span.items-left");
  const t = (badge?.textContent || "").toLowerCase();
  return t.includes("none") || /\b0\s*available\b/.test(t) || /\bnone-left\b/.test(badge?.className || "");
}

/* NON-DESTRUCTIVE clear (không động vào option invalid/disabled) */
function forceClearAllSelections(root = document) {
  const list = root.querySelector("#checklist, #gr_list, ul.checklist");
  if (!list) return false;
  let cleared = false;
  for (const input of list.querySelectorAll('input[type="checkbox"][id]')) {
    if (input.disabled || !input.checked) continue;
    const lab = list.querySelector(`label[for="${CSS.escape(input.id)}"]`) || input;
    // 1) natural click
    lab.click();
    // 2) fallback: if still checked -> set state + events
    if (input.checked) {
      input.checked = false;
      input.setAttribute("aria-checked", "false");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    cleared = true;
  }
  if (cleared) {
    list.dispatchEvent(new Event("input", { bubbles: true }));
    list.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return cleared;
}

function matchesTokens(input, label, tokens) {
  const v = norm(input?.value || "");
  const labTxt = textWithoutBadges(label);
  const idS = slug(input?.id || "");
  return tokens.some((tok) => {
    const w = norm(tok),
      wslug = slug(tok);
    return (v && v.includes(w)) || (labTxt && labTxt.includes(w)) || (idS && idS === wslug);
  });
}

function clickWidgetByTokens(tokens = [], root = document) {
  const list = root.querySelector("#checklist, #gr_list, ul.checklist");
  if (!list) return false;
  const tks = (tokens || []).map((s) => String(s)).filter(Boolean);
  if (!tks.length) return false;

  const want = tks.map(norm);
  let anyChanged = false;

  const items = list.querySelectorAll("li.list-item");
  for (const li of items) {
    const input = li.querySelector('input[type="checkbox"][id]');
    if (!input) continue;
    const lab = li.querySelector(`label[for="${CSS.escape(input.id)}"]`) || li.querySelector("label.checkbox");
    // skip invalid
    const labCls = lab?.className || "";
    if (input.disabled || /\bline-through\b|\btext-muted\b|\bdisabled\b/.test(labCls)) continue;
    // match by value / label text (without badges) / id slug
    const val = norm(input.value || "");
    const labelTxt = textWithoutBadges(lab);
    const idSlug = slug(input.id || "");
    const hit = want.some((t) => (val && val.includes(t)) || (labelTxt && labelTxt.includes(t)) || (idSlug && idSlug === slug(t)));
    if (!hit) continue;
    if (input.checked) continue; // already selected

    const before = input.checked;
    // 1) label click (fast & correct behavior)
    if (lab) {
      lab.scrollIntoView({ block: "center" });
      lab.click();
    } else {
      input.scrollIntoView({ block: "center" });
      input.click();
    }
    // 2) if state unchanged, try input.click() once more
    if (input.checked === before) {
      input.click();
    }
    // 3) final fallback: set checked + fire events
    if (input.checked === before) {
      input.checked = true;
      input.setAttribute("aria-checked", "true");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (input.checked !== before) anyChanged = true;
  }

  if (anyChanged) {
    // notify widget + jotform
    list.dispatchEvent(new Event("input", { bubbles: true }));
    list.dispatchEvent(new Event("change", { bubbles: true }));
    document.dispatchEvent(new Event("input", { bubbles: true }));
    document.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return anyChanged;
}

/* ===== IFRAME messaging (SELECT/RESOLVE + report value) ===== */

function collectSelectedValues(root = document) {
  const list = getList(root);
  if (!list) return [];
  return Array.from(list.querySelectorAll("input[type='checkbox'][id]:checked")).map((i) => (i.value || i.id || "").trim());
}

if (IS_IFRAME && !window.__JF_IFRAME_READY__) {
  window.__JF_IFRAME_READY__ = true;
  window.addEventListener(
    "message",
    async (ev) => {
      if (!originAllowed(ev.origin, PARENT_ALLOWED_ORIGINS)) return;
      const data = ev.data || {};

      if (data.type === "JF_WIDGET_PING") {
        try {
          ev.source.postMessage({ type: "JF_WIDGET_PONG" }, ev.origin || "*");
        } catch { }
        return;
      }

      if (data.type === "JF_WIDGET_SELECT") {
        await waitWidgetReady(5000);
        const changed = clickWidgetByTokens(data.tokens || [], document);
        const values = collectSelectedValues(document);
        try {
          ev.source.postMessage({ type: "JF_WIDGET_VALUE", values, value: values.join(", ") }, ev.origin || "*");
        } catch { }
        try {
          ev.source.postMessage({ type: "JF_WIDGET_VALUE_DIRTY" }, ev.origin || "*");
        } catch { }
        getList()?.dispatchEvent(new Event("change", { bubbles: true }));
        try {
          ev.source.postMessage({ type: "JF_WIDGET_SELECTED", changed }, ev.origin || "*");
        } catch { }
        return;
      }

      if (data.type === "JF_WIDGET_RESOLVE") {
        await waitWidgetReady(5000);
        const tokens = (data.tokens || []).map(String);
        const cleared = forceClearAllSelections(document);
        let selected = false;
        if (tokens.length) selected = clickWidgetByTokens(tokens, document);
        const values = collectSelectedValues(document);
        try {
          ev.source.postMessage({ type: "JF_WIDGET_VALUE", values, value: values.join(", ") }, ev.origin || "*");
        } catch { }
        getList()?.dispatchEvent(new Event("change", { bubbles: true }));
        document.dispatchEvent(new Event("input", { bubbles: true }));
        document.dispatchEvent(new Event("change", { bubbles: true }));
        try {
          ev.source.postMessage({ type: "JF_WIDGET_VALUE_DIRTY" }, ev.origin || "*");
        } catch { }
        await delay(300);
        try {
          ev.source.postMessage({ type: "JF_WIDGET_RESOLVED", fixed: cleared || selected }, ev.origin || "*");
        } catch { }
        return;
      }
    },
    false
  );
}

/* ===================== PARENT bridge: receive value & unlock NEXT ===================== */

function findCompByIframeWin(win) {
  const frames = Array.from(
    document.querySelectorAll(
      "iframe.custom-field-frame, iframe[id^='customFieldFrame_'], iframe[src*='app-widgets.jotform.io'], iframe[src*='widgets.jotform.io']"
    )
  );
  const ifr = frames.find((f) => f.contentWindow === win);
  return ifr ? ifr.closest("li.form-line[data-type='control_widget']") : null;
}

if (IS_PARENT && !window.__JF_PARENT_BRIDGE__) {
  window.__JF_PARENT_BRIDGE__ = true;
  window.addEventListener(
    "message",
    (ev) => {
      if (!originAllowed(ev.origin, IFRAME_ALLOWED_ORIGINS)) return;
      const data = ev.data || {};

      // When widget value changed: write hidden field + unlock next
      if (data.type === "JF_WIDGET_VALUE") {
        const comp = findCompByIframeWin(ev.source);
        if (comp) {
          const hidden = comp.querySelector("input[type='hidden'], textarea");
          if (hidden) setValueWithEvents(hidden, data.value || (data.values || []).join(", "));
        }
        const card = getActiveCard();
        if (card) {
          card.querySelectorAll(".jfCard-actionsNotification .form-error-message, .form-button-error").forEach((n) => n.remove());
          unlockNext(getNextBtn(card));
        }
        return;
      }

      // Legacy dirty signal still unlocks NEXT
      if (data.type === "JF_WIDGET_VALUE_DIRTY") {
        const card = getActiveCard();
        if (!card) return;
        card.querySelectorAll(".jfCard-actionsNotification .form-error-message, .form-button-error").forEach((n) => n.remove());
        unlockNext(getNextBtn(card));
      }
    },
    false
  );
}

/* ===================== Error helpers (nudge) ===================== */

function hasLineErrorInCard(card) {
  return !!card.querySelector("li.form-line-error, .form-line.form-validation-error, li[aria-invalid='true']");
}

/* phát “dirty” vào widget để JotForm tự bỏ class lỗi mà không đổi lựa chọn */
async function nudgeWidgetDirtyInCard(card, { timeout = 2500 } = {}) {
  const comps = getWidgetComponents(card);
  if (!comps.length) return false;
  let nudged = false;
  for (const comp of comps) {
    const iframe = await waitForWidgetIframeInComp(comp, { appearTimeout: 1200, loadTimeout: 1200 });
    if (!iframe) continue;
    const win = iframe.contentWindow;
    const origin = iframe.src ? new URL(iframe.src).origin : "*";
    let done = false,
      sawPong = false;
    const onPong = (ev) => {
      if (ev.source === win && ev.data?.type === "JF_WIDGET_PONG") sawPong = true;
    };
    window.addEventListener("message", onPong);
    try {
      win.postMessage({ type: "JF_WIDGET_PING" }, origin);
    } catch { }
    const t0 = Date.now();
    while (!sawPong && Date.now() - t0 < 900) {
      await delay(120);
      try {
        win.postMessage({ type: "JF_WIDGET_PING" }, origin);
      } catch { }
    }
    window.removeEventListener("message", onPong);

    const onMsg = (ev) => {
      if (ev.source !== win) return;
      if (!originAllowed(ev.origin, PARENT_ALLOWED_ORIGINS)) return;
      const t = ev.data?.type;
      if (t === "JF_WIDGET_SELECTED" || t === "JF_WIDGET_VALUE_DIRTY" || t === "JF_WIDGET_VALUE") {
        nudged = true;
        done = true;
        window.removeEventListener("message", onMsg);
      }
    };
    window.addEventListener("message", onMsg);
    try {
      win.postMessage({ type: "JF_WIDGET_SELECT", tokens: [] }, origin);
    } catch { }
    const t1 = Date.now();
    while (!done && Date.now() - t1 < timeout) {
      await delay(150);
    }
    window.removeEventListener("message", onMsg);

    // poke hidden so parent listeners fire again
    const hidden = comp.querySelector("input[type='hidden'], textarea");
    hidden?.dispatchEvent(new Event("input", { bubbles: true }));
    hidden?.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (nudged) {
    card.querySelectorAll(".jfCard-actionsNotification .form-error-message, .form-button-error").forEach((n) => n.remove());
    unlockNext(getNextBtn(card));
  }
  return nudged;
}

/* ===================== Smart NEXT/Submit ===================== */

async function smartNextOrSubmit(card, allowSubmit, tokensForWidget = []) {
  const next = getNextBtn(card);
  if (next && isVisible(next)) {
    if (isDisabledBtn(next)) {
      tryAgreeToggles(card);
      // If still disabled & widget present & error flag -> nudge
      if (isDisabledBtn(next) && hasWidgetInCard(card) && hasLineErrorInCard(card)) {
        await nudgeWidgetDirtyInCard(card);
      }
      if (isDisabledBtn(next) && hasWidgetOutOfStockError(card) && hasWidgetInCard(card)) {
        const wasFixed = await resolveWidgetErrorInCard(card, tokensForWidget);
        await delay(250);
        await waitEnabled(next, 900);
        if (wasFixed && isDisabledBtn(next)) {
          card.querySelectorAll(".jfCard-actionsNotification .form-error-message, .form-button-error").forEach((n) => n.remove());
          unlockNext(next);
          await delay(60);
        }
      }
      if (isDisabledBtn(next)) return null;
    }
    next.scrollIntoView({ block: "center" });
    next.click();
    return "next";
  }
  if (allowSubmit) {
    const submit = card.querySelector("button[class*='form-submit-button']") || document.querySelector("button[class*='form-submit-button']");
    if (submit && isVisible(submit) && !isDisabledBtn(submit)) {
      submit.scrollIntoView({ block: "center" });
      submit.click();
      return "submitted";
    }
  }
  return null;
}

/* ===================== Submit-error resolver ===================== */

function collectErrorQids() {
  const ids = new Set();

  // Rail variants
  qsa(
    "#cardProgress .jfProgress-item.hasError .jfProgress-itemLabel[data-item-id],\
#cardProgress .jfProgress-item.isInvalid .jfProgress-itemLabel[data-item-id],\
#cardProgress .jfProgress-item.-error .jfProgress-itemLabel[data-item-id]"
  ).forEach((n) => {
    if (n.dataset.itemId) ids.add(n.dataset.itemId);
  });

  // Fallback A: field-level error
  if (!ids.size) {
    qsa("li.form-line-error, li.form-line[aria-invalid='true'], .form-line.form-validation-error").forEach((li) => {
      const id = (li.id || "").replace(/^id_/, "") || li.dataset.qid;
      if (id) ids.add(id);
    });
  }

  // Fallback B: anchors “Fix” (could be many)
  if (!ids.size) {
    qsa(".form-button-error a[href*='#cid_'], .jfCard-actionsNotification a[href*='#cid_']").forEach((a) => {
      const m = a.getAttribute("href")?.match(/#cid_(\d+)/);
      if (m) ids.add(m[1]);
    });
  }

  return [...ids];
}

async function gotoCardByQid(qid, { timeout = 8000, poll = 150 } = {}) {
  const lbl = qs(`#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`);
  const clickable = lbl?.closest("a,button,.jfProgress-item") || null;
  if (clickable) {
    clickable.scrollIntoView({ block: "center" });
    clickable.click();
    await delay(500); // warm-up
    const targetSel = `#cid_${qid}.isVisible, #id_${qid}.isVisible`;
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      await delay(poll);
      const item = clickable.classList?.contains?.("jfProgress-item") ? clickable : clickable.closest?.(".jfProgress-item");
      if (item?.classList?.contains("isActive") || qs(targetSel)) break;
      clickable.click();
    }
  } else {
    try {
      location.hash = `#cid_${qid}`;
    } catch { }
    await delay(400);
  }
  const scope = qs(`#cid_${qid}`) || qs(`#id_${qid}`) || qs(`li[id="id_${qid}"]`) || qs(".jfCard-wrapper.isVisible");
  scope?.scrollIntoView({ block: "center" });
  scope?.querySelector("input,textarea,select,[tabindex]")?.focus();
  return true;
}

async function waitErrorsReady({ timeout = 9000, poll = 150 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (collectErrorQids().length > 0) return true;
    if (qs(".form-button-error, .jfCard-actionsNotification .form-error-message, .jfErrorMessage")) return true;
    await delay(poll);
  }
  return false;
}

async function resolveErrorsOnCard(tokensForWidget = []) {
  const card = getActiveCard();
  if (!card) return false;
  if (hasWidgetOutOfStockError(card) && hasWidgetInCard(card)) {
    await resolveWidgetErrorInCard(card, tokensForWidget);
    await delay(150);
  }
  tryAgreeToggles(card);
  const res = await smartNextOrSubmit(card, false, tokensForWidget);
  return res === "next";
}

async function handleSubmitErrors({ tokensForWidget = [], maxPasses = 3, waitForQidsMs = 4000 } = {}) {
  const waitIds = async () => {
    const t0 = Date.now();
    let ids = collectErrorQids();
    while (!ids.length && Date.now() - t0 < waitForQidsMs) {
      await delay(200);
      ids = collectErrorQids();
    }
    return ids;
  };

  for (let pass = 0; pass < maxPasses; pass++) {
    const qids = await waitIds();
    if (!qids.length) break;
    for (const qid of qids) {
      await gotoCardByQid(qid, { timeout: 8000, poll: 150 });
      await delay(250);
      await resolveErrorsOnCard(tokensForWidget);
      await delay(250);
    }
    if (!collectErrorQids().length) break;
  }
  return collectErrorQids().length;
}

/* ===== Step into error via PREV/BACK → NEXT ===== */

function getPrevQid(qid) {
  const labels = qsa("#cardProgress .jfProgress-item .jfProgress-itemLabel[data-item-id]");
  const idx = labels.findIndex((n) => n.dataset.itemId === String(qid));
  if (idx > 0) return labels[idx - 1]?.dataset.itemId || null;
  return null;
}

async function gotoPrevOfQid(qid, { timeout = 6000, poll = 120 } = {}) {
  const prev = getPrevQid(qid);
  if (!prev) return false;
  await gotoCardByQid(prev, { timeout, poll });
  return true;
}

function tryClickBack() {
  const back = document.querySelector("button.form-pagebreak-back, button[data-testid^='prevButton_']");
  if (back && isVisible(back) && !isDisabledBtn(back)) {
    back.scrollIntoView({ block: "center" });
    back.click();
    return true;
  }
  return false;
}

async function gotoErrorCard(qid, { timeout = 8000, poll = 150 } = {}) {
  try {
    await gotoCardByQid(qid, { timeout, poll });
  } catch { }
  if (qs(`#cid_${qid}.isVisible, #id_${qid}.isVisible`)) return true;

  const anchors = qsa(".form-button-error a[href*='#cid_'], .jfCard-actionsNotification a[href*='#cid_']");
  const a = anchors.find((x) => new RegExp(`#cid_${qid}\\b`).test(x.getAttribute("href") || "")) || anchors[0];
  if (a) {
    a.scrollIntoView({ block: "center" });
    a.click();
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      await delay(poll);
      if (qs(`#cid_${qid}.isVisible, #id_${qid}.isVisible`)) return true;
    }
  }
  try {
    location.hash = `#cid_${qid}`;
  } catch { }
  await delay(400);
  return !!qs(`#cid_${qid}.isVisible, #id_${qid}.isVisible`);
}

/** cố: PREV→Next; nếu không, vào card lỗi rồi Back→Next */
async function stepIntoErrorViaPrev({ tokensForWidget = [], warmup = 300 } = {}) {
  const errs = collectErrorQids();
  if (!errs.length) return false;
  const targetQid = errs[0];
  const jumpedPrev = await gotoPrevOfQid(targetQid);
  if (jumpedPrev) {
    await delay(warmup);
    const res1 = await smartNextOrSubmit(getActiveCard(), false, tokensForWidget);
    if (res1 === "next") return true;
  }
  const intoErr = await gotoErrorCard(targetQid);
  if (!intoErr) return false;
  if (!tryClickBack()) return false;
  await delay(warmup);
  const res2 = await smartNextOrSubmit(getActiveCard(), false, tokensForWidget);
  return res2 === "next";
}

/* ===================== Main loop (parent) ===================== */

async function mainLoop(payload) {
  const delayTime = Number(payload.delayTime) || 250;
  const allowSubmit = !!payload.submitForm;
  const year = Number(payload.year);
  const month = Number(payload.month);
  const day = Number(payload.day);
  const inputTxtArr = Array.isArray(payload.inputTxtArr) ? payload.inputTxtArr : [];
  const checkboxTxtArr = Array.isArray(payload.checkboxTxtArr) ? payload.checkboxTxtArr : [];
  const tokensForWidget = checkboxTxtArr.flat();

  let started = false,
    lastCardId = "";
  let lastSubmitQid = null;
  let idleLoops = 0;

  while (window.isFilling) {
    await delay(delayTime);

    if (!started) {
      const startBtn = qs("#jfCard-welcome-start");
      if (startBtn?.checkVisibility?.() || isVisible(startBtn)) {
        startBtn.click();
        started = true;
      }
    }

    const card = getActiveCard();
    if (!card) continue;

    const hasSubmitHere = !!(card.querySelector("button[class*='form-submit-button']") || document.querySelector("button[class*='form-submit-button']"));
    if (hasSubmitHere) lastSubmitQid = cardIdToQid(card);

    const cardId = card.id || "";
    if (cardId === lastCardId) {
      const a = await smartNextOrSubmit(card, allowSubmit, tokensForWidget);
      if (a === "next" || a === "submitted") {
        idleLoops = 0;
        await delay(delayTime);
        if (a === "submitted") {
          await waitErrorsReady({ timeout: 9000, poll: 150 });
          if (!hasValidationErrors() && collectErrorQids().length === 0) {
            window.isFilling = false;
            window.__FILL_LOOP_RUNNING__ = false;
            break;
          }
          // Prefer stepping-around to reuse auto-select/resolve
          const stepped = await stepIntoErrorViaPrev({ tokensForWidget, warmup: 300 });
          if (stepped) {
            await delay(delayTime);
            continue;
          }
          const remaining = await handleSubmitErrors({ tokensForWidget, maxPasses: 3, waitForQidsMs: 9000 });
          if (remaining === 0 && lastSubmitQid) {
            await gotoCardByQid(lastSubmitQid);
            await delay(300);
            const submitCard = getActiveCard();
            submitCard?.querySelector("button[class*='form-submit-button']")?.click();
            await waitErrorsReady({ timeout: 9000, poll: 150 });
            if (!hasValidationErrors() && collectErrorQids().length === 0) {
              window.isFilling = false;
              window.__FILL_LOOP_RUNNING__ = false;
              break;
            }
          }
        }
        continue;
      }

      // No progress: increase watchdog and escalate when threshold is reached
      idleLoops++;
      if (idleLoops >= 6) {
        const sawErrors =
          hasValidationErrors() || qsa(".form-button-error, .jfCard-actionsNotification .form-error-message, .jfErrorMessage, .error-message").length > 0;
        if (sawErrors) {
          // quick nudge on current card if widget + error flag
          if (hasWidgetInCard(card) && hasLineErrorInCard(card)) {
            const ok = await nudgeWidgetDirtyInCard(card);
            if (ok) {
              idleLoops = 0;
              continue;
            }
          }
          await handleSubmitErrors({ tokensForWidget, maxPasses: 3, waitForQidsMs: 9000 });
          if (!collectErrorQids().length && lastSubmitQid && allowSubmit) {
            await gotoCardByQid(lastSubmitQid);
            await delay(300);
            const submitCard = getActiveCard();
            submitCard?.querySelector("button[class*='form-submit-button']")?.click();
            await waitErrorsReady({ timeout: 9000, poll: 150 });
          }
        } else {
          const next = getNextBtn(card);
          if (next && isDisabledBtn(next)) {
            tryAgreeToggles(card);
            unlockNext(next);
            await delay(80);
            next?.click();
          }
        }
        idleLoops = 0;
      }
      continue;
    }

    // moved to a new card -> reset watchdog
    idleLoops = 0;
    lastCardId = cardId;

    // ==== Autofill per field
    const fieldId = (card.id || "").replace("cid_", "");
    const comps = qsa("[data-type]", card);
    for (const comp of comps) {
      const type = comp.getAttribute("data-type");
      switch (type) {
        case "first":
          fillInto(comp, "first", payload.firstName);
          break;
        case "last":
          fillInto(comp, "last", payload.lastName);
          break;
        case "email":
          fillInto(comp, "email", payload.email);
          break;
        case "control_phone":
        case "mask-number":
          await fillMaskedPhone(comp, payload.phone);
          break;
        case "control_datetime":
        case "control_date":
        case "liteDate":
          setLiteDate(fieldId, year, month, day);
          break;
        case "input-textbox": {
          const input = comp;
          const label =
            input.labels?.[0]?.querySelector(".jsQuestionLabelContainer")?.textContent?.trim() ||
            document.getElementById(input.getAttribute("aria-labelledby"))?.querySelector(".jsQuestionLabelContainer")?.textContent?.trim() ||
            document.querySelector(`label[for="${CSS.escape(input.id)}"] .jsQuestionLabelContainer`)?.textContent?.trim() ||
            "";
          const map = inputTxtArr.find((m) => (m.text || []).some((t) => (label || "").toLowerCase().includes(String(t).toLowerCase())));
          if (map) {
            input.value = map.value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
          break;
        }
        case "control_radio": {
          const labelText = getFieldLabelText(comp);
          const tks = tokensForWidget;
          if (isConsentGroup(labelText) || (tks.length && tks.some((t) => labelText.toLowerCase().includes(String(t).toLowerCase())))) {
            selectRadioAgree(comp, tks);
          }
          break;
        }
        case "control_checkbox": {
          const boxes = comp.querySelectorAll("input[type='checkbox']");
          if (boxes.length === 1) {
            const labelText = getFieldLabelText(comp);
            if (isConsentGroup(labelText) && !boxes[0].checked) {
              boxes[0].click();
              boxes[0].dispatchEvent(new Event("change", { bubbles: true }));
            }
          }
          break;
        }
        default:
          break;
      }

      // Fallback fill
      const fc = comp.querySelector("input[data-component='first']");
      const lc = comp.querySelector("input[data-component='last']");
      const ec = comp.querySelector("input[data-component='email']");
      if (fc || lc || ec) {
        if (fc) fillInto(comp, "first", payload.firstName);
        if (lc) fillInto(comp, "last", payload.lastName);
        if (ec) fillInto(comp, "email", payload.email);
      }
    }

    // ==== Widget select / resolve
    if (tokensForWidget.length && hasWidgetInCard(card)) {
      await selectWidgetOptionsInCard(card, tokensForWidget, 5000);
      if (hasWidgetOutOfStockError(card)) {
        await resolveWidgetErrorInCard(card, tokensForWidget, 5000);
      }
    }

    // If card currently has error flag -> nudge to clear error class like manual click
    if (hasWidgetInCard(card) && hasLineErrorInCard(card)) {
      await nudgeWidgetDirtyInCard(card);
    }

    // ==== Next / Submit
    const act = await smartNextOrSubmit(card, allowSubmit, tokensForWidget);
    if (act === "next") {
      await delay(delayTime);
      continue;
    }
    if (act === "submitted") {
      await waitErrorsReady({ timeout: 9000, poll: 150 });
      if (!hasValidationErrors() && collectErrorQids().length === 0) {
        window.isFilling = false;
        window.__FILL_LOOP_RUNNING__ = false;
        break;
      }
      const stepped = await stepIntoErrorViaPrev({ tokensForWidget, warmup: 300 });
      if (stepped) {
        await delay(delayTime);
        continue;
      }
      const remaining = await handleSubmitErrors({ tokensForWidget, maxPasses: 3, waitForQidsMs: 9000 });
      if (remaining === 0 && lastSubmitQid) {
        await gotoCardByQid(lastSubmitQid);
        await delay(300);
        const submitCard = getActiveCard();
        submitCard?.querySelector("button[class*='form-submit-button']")?.click();
        await waitErrorsReady({ timeout: 9000, poll: 150 });
        if (!hasValidationErrors() && collectErrorQids().length === 0) {
          window.isFilling = false;
          window.__FILL_LOOP_RUNNING__ = false;
          break;
        }
      }
      continue;
    }
  }

  // graceful exit
  window.__FILL_LOOP_RUNNING__ = false;
}

/* ===================== Boot ===================== */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "stopFilling") {
    window.isFilling = false;
    window.__FILL_LOOP_RUNNING__ = false;
    sendResponse({ ok: true });
    return false;
  }
  if (msg.action !== "startFilling") return;

  // prevent multiple concurrent loops
  if (window.__FILL_LOOP_RUNNING__) {
    window.isFilling = true;
    sendResponse({ ok: true, note: "Filling loop already running" });
    return false;
  }
  window.__FILL_LOOP_RUNNING__ = true;
  window.isFilling = true;

  if (IS_PARENT) {
    Promise.resolve().then(() => mainLoop(msg.data || {}));
  }

  sendResponse({ ok: true });
  return false;
});
