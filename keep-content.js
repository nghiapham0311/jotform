/**
 * content.js — Robust: select works + enter error page + clear-invalid to unlock NEXT
 * - GIỮ NGUYÊN logic select option của bạn (không thay đổi ưu tiên/wishlist)
 * - Khi vào error page (form-line-error / animate-shake), tự uncheck option invalid trong iframe rồi NEXT
 */

/* ===================== Tiny utils ===================== */
const qs = (s, r = document) => r.querySelector(s);
const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
const delay = (ms) => new Promise(r => setTimeout(r, ms));

const IS_PARENT = location.host === "form.jotform.com";
const IS_IFRAME = /\.jotform\.io$/.test(location.host);

const norm = (s) => String(s || "").toLowerCase().trim();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ===================== Visibility / Disabled ===================== */
function isVisible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
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
function getActiveCard() {
    const cards = qsa(".jfCard-wrapper.isVisible");
    return cards.length ? cards[cards.length - 1] : null;
}
function cardIdToQid(card) { return (card?.id || "").replace("cid_", ""); }
function getNextBtn(card) {
    return card.querySelector("button[data-testid^='nextButton_']") ||
        card.querySelector("button.form-pagebreak-next") ||
        card.querySelector("button[name='next']");
}

/* ===================== Generic fillers ===================== */
function fillInto(comp, part, val) {
    if (val == null || val === "") return false;
    const el = comp.querySelector(`input[data-component='${part}']`) ||
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
    try { el.setSelectionRange(String(val).length, String(val).length); } catch { }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertFromPaste", data: String(val) }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
}
async function fillMaskedPhone(comp, phoneStr) {
    const digits = digitsOnly(phoneStr);
    if (!digits) return false;

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

    el = comp.querySelector("input[type='tel']");
    if (el) { setValueWithEvents(el, digits); return true; }

    return false;
}
function setLiteDate(fieldId, y, m, d) {
    if (m < 10) m = `0${m}`; if (d < 10) d = `0${d}`;
    const field = qs(`#lite_mode_${fieldId}`); if (!field) return false;
    const sep = field.getAttribute("data-seperator") || field.getAttribute("seperator") || "/";
    const fmt = field.getAttribute("data-format") || field.getAttribute("format") || "mmddyyyy";
    let text = `${m}${sep}${d}${sep}${y}`;
    if (fmt === "ddmmyyyy") text = `${d}${sep}${m}${sep}${y}`;
    if (fmt === "yyyymmdd") text = `${y}${sep}${m}${sep}${d}`;
    field.value = text;
    const iso = qs(`#input_${fieldId}`); if (iso) iso.value = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const ev = document.createEvent("HTMLEvents"); ev.initEvent("dataavailable", true, true); ev.eventName = "date:changed";
    qs(`#id_${fieldId}`)?.dispatchEvent(ev);
    return true;
}

/* ===================== Consent helpers ===================== */
function getFieldLabelText(comp) {
    const input = comp.querySelector("input, textarea, select");
    const ariaIds = (input?.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
    const pieces = ariaIds.map(id => (document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || ""));
    let text = pieces.join(" ").trim();
    if (!text) {
        const container = comp.closest("li[id^='id_'], [data-type]") || comp;
        const labelEl =
            container.querySelector(".jfQuestion-label, .jf-question-label, .form-label") ||
            container.querySelector("[id^='label_']") || container.querySelector("label");
        if (labelEl) text = (labelEl.innerText || labelEl.textContent || "").trim();
    }
    return text.replace(/\*\s*$/, "").replace(/\bThis field is required\.?$/i, "").replace(/\s+/g, " ").trim();
}
function isConsentGroup(labelText) {
    const s = (labelText || "").toLowerCase();
    return /\bagree|accept|consent|terms|policy|privacy|understand|acknowledge|yes\b/.test(s);
}
function getRadioOptions(comp) {
    return qsa("input[type='radio']", comp).map(input => {
        let txt = "";
        const wrap = input.closest("label");
        if (wrap) { const t = wrap.querySelector(".jfRadio-labelText") || wrap; txt = (t.innerText || t.textContent || "").trim(); }
        else {
            const lab = comp.querySelector(`label[for='${input.id}']`);
            const t = lab?.querySelector(".jfRadio-labelText") || lab;
            if (t) txt = (t.innerText || t.textContent || "").trim();
        }
        return { input, text: txt, value: (input.value || "").trim() };
    });
}
function selectRadioAgree(comp, tokens = []) {
    const opts = getRadioOptions(comp); if (!opts.length) return false;
    const tks = (tokens || []).map(t => String(t).toLowerCase()).filter(Boolean);
    const syn = ['agree', 'i agree', 'accept', 'i accept', 'consent', 'yes', 'ok', 'okay', 'i understand', 'understand', 'acknowledge'];
    const hit = opts.find(o => {
        const tx = o.text.toLowerCase(), vv = o.value.toLowerCase();
        return (tks.length && tks.some(t => tx.includes(t) || vv.includes(t))) || syn.some(t => tx.includes(t) || vv.includes(t));
    });
    if (!hit) return false;
    if (!hit.input.checked) { hit.input.click(); hit.input.dispatchEvent(new Event("change", { bubbles: true })); }
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
    const keys = ['agree', 'accept', 'consent', 'i understand', 'understand', 'acknowledge', 'terms', 'policy', 'privacy', 'yes', 'ok', 'okay'];
    let changed = false;
    for (const el of inputs) {
        const txt = getTxt(el);
        if (keys.some(k => txt.includes(k)) && !el.checked) {
            el.click(); el.dispatchEvent(new Event("change", { bubbles: true })); changed = true;
        }
    }
    return changed;
}

/* ===================== Validation / Error flow ===================== */
function hasValidationErrors() {
    return !!(
        document.querySelector('#cardProgress .jfProgress-item.hasError') ||
        document.querySelector('.form-button-error') ||
        document.querySelector('.jfCard-actionsNotification .form-error-message') ||
        document.querySelector('li.form-line-error, .form-validation-error, [aria-invalid="true"]')
    );
}
function hasLineErrorInCard(card) {
    return !!(
        card.querySelector('li.form-line-error, .form-line.form-validation-error, li[aria-invalid="true"]') ||
        card.classList.contains('animate-shake') ||
        card.querySelector('.jfCard.animate-shake')
    );
}
async function waitErrorsReady({ timeout = 9000, poll = 150 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        await delay(poll);
        if (hasValidationErrors()) return true;
    }
    return hasValidationErrors();
}
function collectErrorQids() {
    const ids = new Set();
    qsa('#cardProgress .jfProgress-item.hasError .jfProgress-itemLabel[data-item-id]')
        .forEach(n => { if (n.dataset.itemId) ids.add(n.dataset.itemId); });
    // fallback field-level
    if (!ids.size) {
        qsa('li.form-line-error, li.form-line[aria-invalid="true"], .form-line.form-validation-error')
            .forEach(li => { const id = (li.id || '').replace(/^id_/, '') || li.dataset.qid; if (id) ids.add(id); });
    }
    // fallback banner "Fix"
    if (!ids.size) {
        const href =
            qs('.form-button-error a[href*="#cid_"]')?.getAttribute('href') ||
            qs('.jfCard-actionsNotification a[href*="#cid_"]')?.getAttribute('href');
        const m = href && href.match(/#cid_(\d+)/);
        if (m) ids.add(m[1]);
    }
    return [...ids];
}
async function gotoCardByQid(qid, { timeout = 5000, poll = 150 } = {}) {
    const lbl = qs(`#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`);
    const item = lbl?.closest('.jfProgress-item');
    if (item) {
        item.scrollIntoView({ block: 'center' }); item.click();
        const targetSel = `#cid_${qid}.isVisible`;
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
            await delay(poll);
            if (item.classList.contains('isActive') || qs(targetSel)) break;
        }
    } else {
        try { location.hash = `#cid_${qid}`; } catch { }
    }
    const scope = qs(`#id_${qid}`) || qs(`#cid_${qid}`) || qs('.jfCard-wrapper.isVisible');
    scope?.querySelector('input,textarea,select,[tabindex]')?.focus();
    return true;
}
async function stepIntoErrorViaPrev({ tokensForWidget = [], warmup = 300 } = {}) {
    // nhảy về card trước (nếu có), rồi click NEXT để re-run select/bridge
    const active = qs('#cardProgress .jfProgress-item.isActive');
    const prev = active?.previousElementSibling;
    if (!prev) return false;
    prev.scrollIntoView({ block: 'center' }); prev.click();
    await delay(warmup);
    const card = getActiveCard();
    if (!card) return false;
    if (tokensForWidget.length && hasWidgetInCard(card)) {
        await selectWidgetOptionsInCard(card, tokensForWidget, 2000);
        await delay(120);
    }
    const act = await smartNextOrSubmit(card, false, tokensForWidget);
    return act === 'next';
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
        "iframe[src*='widgets.jotform.io']"
    ].join(",");
    const ifr = comp.querySelector(sel);
    return (ifr && isVisible(ifr)) ? ifr : null;
}
function waitForWidgetIframeInComp(comp, { appearTimeout = 4000, loadTimeout = 4000 } = {}) {
    return new Promise((resolve) => {
        const ready = () => { const ifr = findWidgetIframeInComp(comp); if (!ifr) return null; return ifr; };
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
            const ifr = ready(); if (!ifr) return;
            clearTimeout(kill); obs.disconnect();
            if (ifr.contentDocument?.readyState === 'complete') { resolve(ifr); return; }
            const onLoad = () => { ifr.removeEventListener('load', onLoad); resolve(ifr); };
            ifr.addEventListener('load', onLoad, { once: true });
            setTimeout(() => { ifr.removeEventListener('load', onLoad); resolve(ifr); }, loadTimeout);
        });
        obs.observe(comp, { childList: true, subtree: true });
    });
}

/* ===== Parent → Iframe: SELECT (giữ nguyên logic chọn) ===== */
async function selectWidgetOptionsInCard(card, tokens = [], timeout = 4000) {
    const comps = getWidgetComponents(card);
    if (!comps.length || !tokens?.length) return false;
    let changed = false;

    for (const comp of comps) {
        const iframe = await waitForWidgetIframeInComp(comp, { appearTimeout: 1500, loadTimeout: 1500 });
        if (!iframe) continue;

        const win = iframe.contentWindow;
        let origin = "*"; try { origin = new URL(iframe.src).origin; } catch { }
        let done = false;

        const onMsg = (ev) => {
            if (ev.source !== win) return;
            const data = ev.data || {};
            if (data.type === "JF_WIDGET_PONG") {
                try { win.postMessage({ type: "JF_WIDGET_SELECT", tokens }, origin); } catch { }
            } else if (data.type === "JF_WIDGET_SELECTED") {
                changed = changed || !!data.changed;
                done = true;
                window.removeEventListener("message", onMsg);
            }
        };
        window.addEventListener("message", onMsg);

        try { win.postMessage({ type: "JF_WIDGET_PING" }, origin); } catch { }
        // fallback: gửi SELECT sớm
        setTimeout(() => { try { win.postMessage({ type: "JF_WIDGET_SELECT", tokens }, origin); } catch { } }, 120);

        const t0 = Date.now();
        while (!done && Date.now() - t0 < timeout) {
            await delay(250);
            try { win.postMessage({ type: "JF_WIDGET_PING" }, origin); } catch { }
        }
        window.removeEventListener("message", onMsg);
    }

    return changed;
}

/* ===== Parent → Iframe: NUDGE/CLEAR-INVALID ===== */
let __RESOLVING_ERRORS__ = false;   // khóa click NEXT trong pha resolve
let __WATCHDOG_ENABLED__ = true;    // bật/tắt watchdog

const T = {
    tick: 120,                // nhịp chờ ngắn
    nextWait: 320,            // chờ sau click NEXT
    railTimeout: 2200,        // chờ rail sạch
    cardCleanTimeout: 1800,   // chờ card sạch
    errorsWaitMax: 4500,      // thay vì 9000
    stuckSameSig: 4500,       // thời gian coi là "đứng yên"
    hardResetAfter: 3         // số lần rescue thất bại trước khi reset card
};
async function nudgeWidgetDirtyInCard(card, timeout = 1500) {
    // chỉ cần bắn clear-invalid để tạo DIRTY, giống tác vụ bạn uncheck bằng tay
    const comps = getWidgetComponents(card); if (!comps.length) return false;
    let nudged = false;

    for (const comp of comps) {
        const iframe = await waitForWidgetIframeInComp(comp, { appearTimeout: 1000, loadTimeout: 1000 });
        if (!iframe) continue;
        const win = iframe.contentWindow;
        let origin = "*"; try { origin = new URL(iframe.src).origin; } catch { }
        let done = false;

        const onMsg = (ev) => {
            if (ev.source !== win) return;
            const d = ev.data || {};
            if (d.type === 'JF_WIDGET_VALUE_DIRTY' || d.type === 'JF_WIDGET_VALUE') nudged = true;
            if (d.type === 'JF_WIDGET_RESOLVED') { nudged = nudged || !!d.fixed; done = true; window.removeEventListener('message', onMsg); }
        };
        window.addEventListener('message', onMsg);

        try { win.postMessage({ type: 'JF_WIDGET_PING' }, origin); } catch { }
        setTimeout(() => { try { win.postMessage({ type: 'JF_WIDGET_RESOLVE', mode: 'clear-invalid' }, origin); } catch { } }, 60);

        const t0 = Date.now();
        while (!done && Date.now() - t0 < timeout) {
            await delay(140);
            try { win.postMessage({ type: 'JF_WIDGET_PING' }, origin); } catch { }
        }
        window.removeEventListener('message', onMsg);

        // nudge hidden
        const hidden = comp.querySelector('input[type="hidden"], textarea');
        hidden?.dispatchEvent(new Event('input', { bubbles: true }));
        hidden?.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return nudged;
}
async function clearInvalidAndUnlockNext(card, timeout = 1800, { unlock = false } = {}) {
    const ok = await nudgeWidgetDirtyInCard(card, timeout);
    if (ok) {
        // remove banner & unlock NEXT ngay tại parent
        card.querySelectorAll(".jfCard-actionsNotification .form-error-message, .form-button-error").forEach(n => n.remove());
        const next = getNextBtn(card);
        if (next) {
            next.disabled = false;
            next.removeAttribute("disabled");
            next.removeAttribute("aria-disabled");
            next.classList.remove("disabled", "isDisabled");
            next.style.pointerEvents = "";
        }
    }
    return ok;
}

/* ===================== Iframe logic (SELECT + CLEAR-INVALID) ===================== */
function waitWidgetReady(maxTime = 5000) {
    return new Promise((resolve) => {
        const ok = () => document.querySelector("#gr_list label.checkbox, #checklist label.checkbox, ul.checklist label.checkbox");
        if (ok()) { resolve(true); return; }
        const obs = new MutationObserver(() => { if (ok()) { obs.disconnect(); resolve(true); } });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => { obs.disconnect(); resolve(!!ok()); }, maxTime);
    });
}
function listRoot(root = document) { return root.querySelector("#gr_list, #checklist, ul.checklist"); }
function labelFor(input, root = document) { return input?.id ? root.querySelector(`label[for='${CSS.escape(input.id)}']`) : null; }
function textWithoutBadges(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(".items-left, span.items-left, .badge").forEach(n => n.remove());
    return norm(clone.textContent || "");
}
function isLabelUnavailable(lab) {
    if (!lab) return true;
    const cls = lab.className || "";
    if (/\bline-through\b|\btext-muted\b|\bdisabled\b/.test(cls)) return true;
    const badge = lab.parentElement?.querySelector(".items-left, span.items-left");
    const t = (badge?.textContent || "").toLowerCase();
    return t.includes("none") || /\b0\s*available\b/.test(t);
}

/* giữ nguyên SELECT nhanh theo DOM của bạn */
function clickWidgetByTokens(tokens = [], root = document) {
    const list = listRoot(root); if (!list) return false;
    const want = (tokens || []).map(norm).filter(Boolean);
    if (!want.length) return false;

    let anyChanged = false;
    const items = list.querySelectorAll("li.list-item");
    for (const li of items) {
        const input = li.querySelector('input[type="checkbox"][id]');
        if (!input) continue;
        const lab = li.querySelector(`label[for="${CSS.escape(input.id)}"]`) || li.querySelector("label.checkbox");

        if (isLabelUnavailable(lab)) continue;

        const val = norm(input.value || "");
        const txt = textWithoutBadges(lab);
        const idSlug = slug(input.id || "");
        const hit = want.some(t => (val && val.includes(t)) || (txt && txt.includes(t)) || (idSlug && idSlug === slug(t)));
        if (!hit) continue;

        if (input.checked) continue;

        const before = input.checked;
        (lab || input).click();
        if (input.checked === before) input.click();
        if (input.checked === before) {
            input.checked = true;
            input.setAttribute("aria-checked", "true");
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        if (input.checked !== before) anyChanged = true;
    }

    if (anyChanged) {
        list.dispatchEvent(new Event("input", { bubbles: true }));
        list.dispatchEvent(new Event("change", { bubbles: true }));
        document.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return anyChanged;
}

if (IS_IFRAME && !window.__JF_IFRAME_READY__) {
    window.__JF_IFRAME_READY__ = true;
    window.addEventListener("message", async (ev) => {
        const data = ev.data || {};

        if (data.type === "JF_WIDGET_PING") {
            ev.source.postMessage({ type: "JF_WIDGET_PONG" }, ev.origin || "*");
            return;
        }

        if (data.type === "JF_WIDGET_SELECT") {
            await waitWidgetReady(5000);
            const changed = clickWidgetByTokens(data.tokens || [], document);

            // report value về parent để mở khoá NEXT (rất quan trọng để còn vào error page)
            const list = listRoot(document);
            const values = Array.from(list?.querySelectorAll('input[type="checkbox"][id]:checked') || [])
                .map(i => (i.value || i.id || '').trim());
            try { ev.source.postMessage({ type: 'JF_WIDGET_VALUE', values, value: values.join(', ') }, ev.origin || '*'); } catch { }
            try { ev.source.postMessage({ type: 'JF_WIDGET_VALUE_DIRTY' }, ev.origin || '*'); } catch { }

            list?.dispatchEvent(new Event("input", { bubbles: true }));
            list?.dispatchEvent(new Event("change", { bubbles: true }));
            document.dispatchEvent(new Event("change", { bubbles: true }));

            ev.source.postMessage({ type: "JF_WIDGET_SELECTED", changed }, ev.origin || "*");
            return;
        }

        // CLEAR-INVALID: uncheck các option invalid (line-through/None/0 available) — không chọn mới
        if (data.type === "JF_WIDGET_RESOLVE" && data.mode === "clear-invalid") {
            await waitWidgetReady(4000);
            const list = listRoot(document);
            let fixed = false;
            if (list) {
                for (const input of list.querySelectorAll('input[type="checkbox"][id]:checked')) {
                    const lab = labelFor(input, document);
                    if (!isLabelUnavailable(lab)) continue;
                    (lab || input).click();
                    if (input.checked) {
                        input.checked = false;
                        input.dispatchEvent(new Event("input", { bubbles: true }));
                        input.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                    fixed = true;
                }
                if (fixed) {
                    list.dispatchEvent(new Event("input", { bubbles: true }));
                    list.dispatchEvent(new Event("change", { bubbles: true }));
                    document.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
            const values = Array.from(list?.querySelectorAll('input[type="checkbox"][id]:checked') || []).map(i => (i.value || i.id || '').trim());
            try { ev.source.postMessage({ type: "JF_WIDGET_VALUE", values, value: values.join(", ") }, ev.origin || "*"); } catch { }
            try { ev.source.postMessage({ type: "JF_WIDGET_VALUE_DIRTY" }, ev.origin || "*"); } catch { }
            try { ev.source.postMessage({ type: "JF_WIDGET_RESOLVED", fixed }, ev.origin || "*"); } catch { }
            return;
        }
    }, false);
}

/* ===================== Parent bridge: receive value & unlock NEXT ===================== */
if (IS_PARENT && !window.__JF_PARENT_BRIDGE__) {
    window.__JF_PARENT_BRIDGE__ = true;
    window.addEventListener("message", (ev) => {
        const data = ev.data || {};
        if (data.type !== "JF_WIDGET_VALUE" && data.type !== "JF_WIDGET_VALUE_DIRTY") return;

        // Map message source -> widget comp -> hidden field
        const frames = Array.from(document.querySelectorAll(
            "iframe.custom-field-frame, iframe[id^='customFieldFrame_'], iframe[src*='app-widgets.jotform.io'], iframe[src*='widgets.jotform.io']"
        ));
        const comp = frames.find(f => f.contentWindow === ev.source)?.closest("li.form-line[data-type='control_widget']");
        if (comp && data.type === "JF_WIDGET_VALUE") {
            const hidden = comp.querySelector("input[type='hidden'], textarea");
            if (hidden) {
                hidden.value = data.value || (data.values || []).join(", ");
                hidden.dispatchEvent(new Event("input", { bubbles: true }));
                hidden.dispatchEvent(new Event("change", { bubbles: true }));
            }
        }

        const card = getActiveCard();
        if (!card) return;

        // clear visible error + unlock NEXT
        card.querySelectorAll(".jfCard-actionsNotification .form-error-message, .form-button-error").forEach(n => n.remove());
        const next = getNextBtn(card);
        if (next && !__RESOLVING_ERRORS__) {
            next.disabled = false;
            next.removeAttribute("disabled");
            next.removeAttribute("aria-disabled");
            next.classList.remove("disabled", "isDisabled");
            next.style.pointerEvents = "";
        }
    }, false);
}


/* ===================== Smart NEXT / Submit ===================== */
// Helper: đợi xem card có thay đổi không
function railHasError(qid) {
    const lbl = qs(`#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`);
    const item = lbl?.closest('.jfProgress-item');
    return !!(item && item.classList.contains('hasError'));
}


// Đợi card đổi sau khi click NEXT/SUBMIT
async function waitCardChange(oldId, { wait = 350 } = {}) {
    await delay(wait);
    const cur = getActiveCard();
    return !!(cur && cur.id && cur.id !== oldId);
}
async function smartNextOrSubmit(card, allowSubmit, tokensForWidget = []) {
    const next = getNextBtn(card);
    const oldId = card.id || "";
    const qid = cardIdToQid(card);

    // Helper: sau khi đi tiếp, nếu page cũ vẫn hasError → quay lại
    const guardBackIfOldHasError = async (label = "next") => {
        const moved = await waitCardChange(oldId, { wait: 360 });
        if (!moved) return null;
        // Nếu rail của page cũ còn hasError → quay lại resolve tiếp, không cho đi tiếp
        if (railHasError(qid)) {
            await gotoCardByQid(qid, { timeout: 2000, poll: 120 });
            return null;
        }
        return label;
    };

    if (next && isVisible(next)) {
        // Nếu NEXT còn lock do consent → tick
        if (isDisabledBtn(next)) {
            tryAgreeToggles(card);
            if (isDisabledBtn(next)) return null;
        }

        // tránh NEXT khi đang resolve bị khóa cờ (đã có chặn ngoài, nhưng thêm chốt ở đây)
        if (__RESOLVING_ERRORS__) return null;

        next.scrollIntoView({ block: "center" });
        next.click();

        // Guard sau click NEXT
        const g = await guardBackIfOldHasError("next");
        if (g) return g;

        // Nếu chưa đổi card → thử nudge widget nhanh rồi click lại 1 lần
        if (hasWidgetInCard(card) && hasLineErrorInCard(card)) {
            await nudgeWidgetDirtyInCard(card);
            await waitCardCleanFast(card, { timeout: 1400 });
            await waitRailClearedFast(qid, { timeout: 1800 });

            if (isDisabledBtn(next)) tryAgreeToggles(card);
            next.click();
            const g2 = await guardBackIfOldHasError("next");
            if (g2) return g2;
        }

        return null;
    }

    if (allowSubmit) {
        // Gate: nếu rail còn QID lỗi → KHÔNG submit, để handleSubmitErrors xử lý trước
        if (collectErrorQids().length) return null;

        const submit = card.querySelector("button[class*='form-submit-button']") ||
            document.querySelector("button[class*='form-submit-button']");
        if (submit && isVisible(submit) && !isDisabledBtn(submit)) {
            submit.scrollIntoView({ block: "center" });
            submit.click();

            // Guard: nếu submit đổi trang nhưng rail cũ còn hasError (rare) → coi như chưa submit
            const moved = await waitCardChange(oldId, { wait: 360 });
            if (moved && railHasError(qid)) {
                await gotoCardByQid(qid, { timeout: 2000, poll: 120 });
                return null;
            }
            return "submitted";
        }
    }

    return null;
}


// ===== Observer-based wait helpers =====
function getRailEl() { return qs('#cardProgress'); }

function buildStateSig() {
    const card = getActiveCard(); if (!card) return 'nocard';
    const qid = cardIdToQid(card) || 'x';
    const next = getNextBtn(card);
    const disabled = isDisabledBtn(next) ? 1 : 0;
    // gom QID lỗi (đừng gọi collectErrorQids() quá dày — chỉ khi cần)
    const hasErr = !!(
        getRailEl()?.querySelector('.jfProgress-item.hasError') ||
        card.querySelector('li.form-line-error, .form-line.form-validation-error, [aria-invalid="true"]') ||
        card.classList.contains('animate-shake')
    );
    return `${qid}|${disabled}|${hasErr ? 1 : 0}`;
}

async function rescueCurrentCard(tokensForWidget = []) {
    const card = getActiveCard(); if (!card) return false;

    // 1) ưu tiên widget: bắn select lại (giữ nguyên logic) + nudge/clear-invalid
    if (hasWidgetInCard(card)) {
        // re-select theo tokens bạn truyền vào (không đổi logic chọn)
        await selectWidgetOptionsInCard(card, tokensForWidget, 1500);
        await nudgeWidgetDirtyInCard(card, 1200);
        await clearInvalidAndUnlockNext(card, 1400, { unlock: false });
        await waitCardCleanFast(card, { timeout: T.cardCleanTimeout });
        await waitRailClearedFast(cardIdToQid(card), { timeout: T.railTimeout });
    }

    // 2) consent/agree nếu còn lock
    tryAgreeToggles(card);

    // 3) thử NEXT 1 lần (không submit)
    const moved = await smartNextOrSubmit(card, false, tokensForWidget);
    return moved === 'next';
}

async function hardResetActiveCard() {
    // click lại mục đang active trong rail để “refresh” nội bộ, không reload trang
    const card = getActiveCard(); if (!card) return;
    const qid = cardIdToQid(card);
    const lbl = qs(`#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`);
    lbl?.closest('.jfProgress-item')?.click();
    await delay(160);
}

function nextFrame() {
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}

// Chờ predicate đổi sang "true" bằng MutationObserver, tối đa timeout
function waitWithObserver(target, { predicate, timeout = 2000 }) {
    return new Promise(resolve => {
        if (!target) return resolve(false);
        if (predicate?.()) return resolve(true);

        const obs = new MutationObserver(() => {
            if (predicate?.()) {
                obs.disconnect();
                resolve(true);
            }
        });
        obs.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-invalid'] });

        const t = setTimeout(() => { obs.disconnect(); resolve(predicate?.() || false); }, timeout);
    });
}

// Card sạch khi: không còn li.form-line-error / [aria-invalid=true] / animate-shake
async function waitCardCleanFast(card, { timeout = 1800 } = {}) {
    const ok = () => !(
        card.querySelector('li.form-line-error, .form-line.form-validation-error, li[aria-invalid="true"]') ||
        card.classList.contains('animate-shake') ||
        card.querySelector('.jfCard.animate-shake')
    );
    const res = await waitWithObserver(card, { predicate: ok, timeout });
    if (!res) return ok();       // fallback best-effort
    await nextFrame();           // ổn định 2 frame
    return true;
}

// Rail sạch cho QID khi .hasError biến mất
async function waitRailClearedFast(qid, { timeout = 2500 } = {}) {
    const lbl = qs(`#cardProgress .jfProgress-itemLabel[data-item-id="${qid}"]`);
    const item = lbl?.closest('.jfProgress-item');
    const ok = () => !railHasError(qid);
    const res = await waitWithObserver(item || document.body, { predicate: ok, timeout });
    if (!res) return ok();
    await nextFrame();
    return true;
}
/* ===================== Submit-error resolver (multi-pass) ===================== */
async function resolveErrorsOnCard(tokensForWidget = [], { advance = false } = {}) {
    const card = getActiveCard(); if (!card) return false;
    const qid = cardIdToQid(card);

    if (hasWidgetInCard(card) && hasLineErrorInCard(card)) {
        await clearInvalidAndUnlockNext(card, 1400, { unlock: false });
        await waitCardCleanFast(card, { timeout: T.cardCleanTimeout });
        await waitRailClearedFast(qid, { timeout: T.railTimeout });
    }

    tryAgreeToggles(card);

    if (!advance) return true;
    const res = await smartNextOrSubmit(card, false, tokensForWidget);
    return res === 'next';
}
async function handleSubmitErrors({ tokensForWidget = [], maxLoops = 6, waitForQidsMs = 4500 } = {}) {
    const waitIds = async () => {
        const t0 = Date.now();
        let ids = collectErrorQids();
        while (!ids.length && Date.now() - t0 < waitForQidsMs) {
            await delay(150);
            ids = collectErrorQids();
        }
        return ids;
    };

    __RESOLVING_ERRORS__ = true;
    try {
        let prevCount = Infinity, noProgress = 0;

        for (let loop = 0; loop < maxLoops; loop++) {
            const qids = await waitIds();
            if (!qids.length) break;

            for (const qid of qids) {
                await gotoCardByQid(qid, { timeout: 4500, poll: 120 });
                await delay(80);
                await resolveErrorsOnCard(tokensForWidget, { advance: false });
                await waitRailClearedFast(qid, { timeout: 2200 });
                const cur = getActiveCard();
                if (cur && cardIdToQid(cur) === qid) {
                    await waitCardCleanFast(cur, { timeout: 1800 });
                }
                await nextFrame();
            }

            const now = collectErrorQids().length;
            if (now === 0) break;
            if (now >= prevCount) {
                noProgress++;
                if (noProgress >= 2) break; // tránh loop vô hạn
            } else {
                noProgress = 0;
            }
            prevCount = now;
        }
        return collectErrorQids().length;
    } finally {
        __RESOLVING_ERRORS__ = false;
    }
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

    let started = false, lastCardId = "";
    let lastSubmitQid = null;
    let lastSig = "";
    let lastSigAt = Date.now();
    let rescueFails = 0;

    while (window.isFilling) {
        await delay(delayTime);

        if (!started) {
            const startBtn = qs("#jfCard-welcome-start");
            if (startBtn?.checkVisibility?.() || isVisible(startBtn)) { startBtn.click(); started = true; }
        }

        const card = getActiveCard();
        if (!card) continue;

        // nhớ trang có submit để quay lại sau
        const hasSubmitHere = !!(card.querySelector("button[class*='form-submit-button']") || document.querySelector("button[class*='form-submit-button']"));
        if (hasSubmitHere && allowSubmit && collectErrorQids().length) {
            await handleSubmitErrors({ tokensForWidget, maxLoops: 6, waitForQidsMs: 4000 });
            // Sau resolve xong, nếu còn ở submit page thì mới thử submit
            await delay(120);
            continue;
        }
        if (hasSubmitHere) lastSubmitQid = cardIdToQid(card);
        // --- Watchdog: nếu trạng thái không đổi quá lâu -> rescue ---
        if (__WATCHDOG_ENABLED__) {
            const sig = buildStateSig();
            if (sig === lastSig) {
                if (Date.now() - lastSigAt > T.stuckSameSig && !__RESOLVING_ERRORS__) {
                    // Ưu tiên cứu tại chỗ (kể cả page 1)
                    const ok = await rescueCurrentCard(tokensForWidget);
                    lastSigAt = Date.now();
                    if (!ok) {
                        rescueFails++;
                        if (rescueFails >= T.hardResetAfter) {
                            await hardResetActiveCard();   // refresh card qua rail
                            rescueFails = 0;
                        }
                    } else {
                        rescueFails = 0;
                    }
                    // tiếp tục vòng
                    await delay(T.tick);
                    continue;
                }
            } else {
                lastSig = sig;
                lastSigAt = Date.now();
                rescueFails = 0;
            }
        }

        const cardId = card.id || "";
        if (cardId === lastCardId) {
            // nếu đang ở error page của widget: nudge dirty trước
            if (hasWidgetInCard(card) && hasLineErrorInCard(card)) {
                await nudgeWidgetDirtyInCard(card);
            }
            if (__RESOLVING_ERRORS__) {
                await delay(120);
                continue;
            }
            const act0 = await smartNextOrSubmit(card, allowSubmit, tokensForWidget);
            if (act0 === "next" || act0 === "submitted") {
                if (act0 === "submitted") await waitErrorsReady({ timeout: T.errorsWaitMax, poll: 120 });
                if (act0 === "submitted" && !hasValidationErrors() && collectErrorQids().length === 0) {
                    window.isFilling = false; break;
                }
                // sau submit -> thử bước vào trang lỗi qua prev nếu cần
                if (act0 === "submitted") {
                    const stepped = await stepIntoErrorViaPrev({ tokensForWidget, warmup: 300 });
                    if (stepped) { await delay(delayTime); continue; }

                    const remaining = await handleSubmitErrors({ tokensForWidget, maxPasses: 3, waitForQidsMs: 9000 });
                    if (remaining === 0 && lastSubmitQid) {
                        await gotoCardByQid(lastSubmitQid);
                        await delay(300);
                        const submitCard = getActiveCard();
                        submitCard?.querySelector("button[class*='form-submit-button']")?.click();
                        await waitErrorsReady({ timeout: T.errorsWaitMax, poll: 120 });
                        if (!hasValidationErrors() && collectErrorQids().length === 0) {
                            window.isFilling = false; break;
                        }
                    }
                }
                await delay(delayTime);
                continue;
            }

            // không tiến triển -> loop tiếp
            continue;
        }

        // sang card mới
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
                    if (map) { input.value = map.value; input.dispatchEvent(new Event("input", { bubbles: true })); }
                    break;
                }

                case "control_radio": {
                    const labelText = getFieldLabelText(comp);
                    const tks = tokensForWidget;
                    if (isConsentGroup(labelText) || (tks.length && tks.some(t => labelText.toLowerCase().includes(String(t).toLowerCase())))) {
                        selectRadioAgree(comp, tks);
                    }
                    break;
                }

                case "control_checkbox": {
                    const boxes = comp.querySelectorAll("input[type='checkbox']");
                    if (boxes.length === 1) {
                        const labelText = getFieldLabelText(comp);
                        if (isConsentGroup(labelText) && !boxes[0].checked) {
                            boxes[0].click(); boxes[0].dispatchEvent(new Event("change", { bubbles: true }));
                        }
                    }
                    break;
                }

                default: break;
            }
        }

        // ==== Widget select (giữ nguyên cơ chế bạn đang có)
        if (checkboxTxtArr.length && hasWidgetInCard(card)) {
            await selectWidgetOptionsInCard(card, checkboxTxtArr.flat(), 5000);
            await delay(120); // cho bridge VALUE/ DIRTY unlock NEXT
        }

        // ==== Next / Submit
        const act = await smartNextOrSubmit(card, allowSubmit, checkboxTxtArr.flat());
        if (act === "next") { await delay(delayTime); continue; }
        if (act === "submitted") {
            await waitErrorsReady({ timeout: T.errorsWaitMax, poll: 120 });
            if (!hasValidationErrors() && collectErrorQids().length === 0) {
                window.isFilling = false; break;
            }

            const remaining = await handleSubmitErrors({ tokensForWidget: checkboxTxtArr.flat(), maxPasses: 3, waitForQidsMs: 4000 });
            if (remaining === 0 && lastSubmitQid) {
                await gotoCardByQid(lastSubmitQid);
                await delay(200);
                const submitCard = getActiveCard();
                submitCard?.querySelector("button[class*='form-submit-button']")?.click();
                await waitErrorsReady({ timeout: T.errorsWaitMax, poll: 120 });
                if (!hasValidationErrors() && collectErrorQids().length === 0) {
                    window.isFilling = false; break;
                }
            }
            continue;
        }
    }
}

/* ===================== Boot ===================== */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "stopFilling") {
        window.isFilling = false;
        __RESOLVING_ERRORS__ = false;
        sendResponse({ ok: true });
        return false;
    }
    if (msg.action !== "startFilling") return;
    window.isFilling = true;
    if (IS_PARENT) { Promise.resolve().then(() => mainLoop(msg.data || {})); }
    sendResponse({ ok: true });
    return false;
});
