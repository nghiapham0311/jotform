// popup.js
document.addEventListener('DOMContentLoaded', () => {
  // hydrate basic fields from localStorage with sensible defaults
  const byId = id => document.getElementById(id);

  byId('includeSpecialEvent').checked = JSON.parse(localStorage.getItem('includeSpecialEvent') || 'false');

  // persist
  byId('includeSpecialEvent').addEventListener('change', e => {
    localStorage.setItem('includeSpecialEvent', e.target.checked);
  });

  // ====== Days to auto-fill (UI) ======
  const DAY_COUNT = 31;                                  // đổi nếu cần
  const daysGrid = document.getElementById('days-grid');

  function defaultEnabledDays() {
    return Array.from({ length: DAY_COUNT }, (_, i) => i + 1);
  }

  function loadEnabledDays() {
    const raw = localStorage.getItem('enabledDays');
    if (!raw) {
      const def = defaultEnabledDays();
      localStorage.setItem('enabledDays', JSON.stringify(def));
      return def;
    }
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr.map(Number);
      const def = defaultEnabledDays();
      localStorage.setItem('enabledDays', JSON.stringify(def));
      return def;
    } catch {
      const def = defaultEnabledDays();
      localStorage.setItem('enabledDays', JSON.stringify(def));
      return def;
    }
  }

  function saveEnabledDays() {
    const chosen = [...daysGrid.querySelectorAll('input[type=checkbox]')]
      .filter(cb => cb.checked)
      .map(cb => Number(cb.dataset.day));
    localStorage.setItem('enabledDays', JSON.stringify(chosen));
  }

  function buildDaysUI() {
    const enabled = new Set(loadEnabledDays());
    daysGrid.innerHTML = '';
    for (let d = 1; d <= DAY_COUNT; d++) {
      const id = `af-day-${d}`;
      const wrap = document.createElement('label');
      const cb   = document.createElement('input');
      const sp   = document.createElement('span');
      cb.type = 'checkbox';
      cb.id = id;
      cb.dataset.day = String(d);
      cb.checked = enabled.has(d);              // mặc định: tất cả được bật
      cb.addEventListener('change', saveEnabledDays);
      sp.textContent = `Day ${d}`;
      wrap.appendChild(cb);
      wrap.appendChild(sp);
      daysGrid.appendChild(wrap);
    }
  }

  buildDaysUI();


  const DEFAULT_PAIRS = [{"key":"Name of your Food Truck","value":"A12345678"},{"key":"Legal Bussiness Name","value":"HCMC University of Technology"},{"key":"License Plate Number","value":"Computer Science"},{"key":"State the Truck is Register in","value":"123 Nguyen Hue, District 1"}];

  byId('firstName').value = localStorage.getItem('firstName') || 'first Name';
  byId('lastName').value  = localStorage.getItem('lastName')  || 'last Name';
  byId('email').value     = localStorage.getItem('email')     || 'email@domain.com';
  byId('phone').value     = localStorage.getItem('phone')     || '0123456789';
  byId('dob').value       = localStorage.getItem('dob')       || '';
  byId('delayTime').value = localStorage.getItem('delayTime') || '250';

  // persist edits to those inputs
  document.querySelectorAll('#firstName, #lastName, #email, #phone, #dob, #delayTime')
    .forEach(el => el.addEventListener('change', function () {
      localStorage.setItem(this.id, this.value);
    }));

  const startBtn = byId('start');
  const stopBtn  = byId('stop');
  const status   = byId('statusMessage');

  // submitForm toggle (checkbox)
  const submitFormToggle = byId('submitForm');
  const savedSubmit = localStorage.getItem('submitForm');
  if (savedSubmit !== null) submitFormToggle.checked = JSON.parse(savedSubmit);
  submitFormToggle.addEventListener('change', () => {
    localStorage.setItem('submitForm', submitFormToggle.checked);
  });

  // reflect isRunning state
  chrome.storage.local.get(['isRunning'], ({ isRunning }) => {
    startBtn.disabled = !!isRunning;
    stopBtn.disabled  = !isRunning;
    status.innerText  = isRunning ? 'Working...' : 'Ready...';
  });

  // ----- dynamic key/value text mapping (for input-textbox by label) -----
  const pairsContainer   = byId('pairs-container');        // where pairs appear
  const addPairBtn       = byId('add-pair');               // button to add a pair
  const valuesContainer  = byId('values-container');       // simple list values editor
  const addValueBtn      = byId('add-value');              // button to add a list item

  // load saved simple value list (used for checkbox token matches)
  const savedValueList = JSON.parse(localStorage.getItem('valueList') || '[]');
  savedValueList.forEach(v => addValueRow(v));

  // load saved key/value pairs [{ key, value }]
  const savedPairs = JSON.parse(localStorage.getItem('keyValuePairs') || JSON.stringify(DEFAULT_PAIRS));
  savedPairs.forEach(p => addPairRow(p.key, p.value));

  addPairBtn.addEventListener('click', () => {
    addPairRow();
    savePairs();
  });

  addValueBtn.addEventListener('click', () => {
    addValueRow();
    saveValueList();
  });

  function addPairRow(key = '', value = '') {
    const row = document.createElement('div');
    row.classList.add('pair-item', 'mb-2');

    const k = document.createElement('input');
    k.type = 'text';
    k.placeholder = 'Question';
    k.classList.add('form-control', 'mb-1', 'pair-key');
    k.value = key;

    const v = document.createElement('input');
    v.type = 'text';
    v.placeholder = 'Answer';
    v.classList.add('form-control', 'mb-1', 'pair-value');
    v.value = value;

    const rm = document.createElement('button');
    rm.innerText = 'Remove';
    rm.classList.add('btn', 'btn-danger', 'btn-sm', 'mt-1');
    rm.addEventListener('click', () => {
      pairsContainer.removeChild(row);
      savePairs();
    });

    row.appendChild(k);
    row.appendChild(v);
    row.appendChild(rm);
    pairsContainer.appendChild(row);

    k.addEventListener('input', savePairs);
    v.addEventListener('input', savePairs);
  }

  function savePairs() {
    const items = [];
    document.querySelectorAll('.pair-item').forEach(item => {
      const key = item.querySelector('.pair-key').value;
      const value = item.querySelector('.pair-value').value;
      items.push({ key, value });
    });
    localStorage.setItem('keyValuePairs', JSON.stringify(items));
  }

  function addValueRow(val = '') {
    const row = document.createElement('div');
    row.classList.add('value-item', 'mb-2');

    const v = document.createElement('input');
    v.type = 'text';
    v.placeholder = 'Value';
    v.classList.add('form-control', 'mb-1');
    v.value = val;

    const rm = document.createElement('button');
    rm.innerText = 'Remove';
    rm.classList.add('btn', 'btn-danger', 'btn-sm', 'mt-1');
    rm.addEventListener('click', () => {
      valuesContainer.removeChild(row);
      saveValueList();
    });

    row.appendChild(v);
    row.appendChild(rm);
    valuesContainer.appendChild(row);

    v.addEventListener('input', saveValueList);
  }

  function saveValueList() {
    const vals = [];
    document.querySelectorAll('.value-item input').forEach(i => vals.push(i.value));
    localStorage.setItem('valueList', JSON.stringify(vals));
  }

  // ----- start/stop -----
  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    stopBtn.disabled  = false;
    status.innerText  = 'Working...';
    console.log('Start button clicked.');

    const [y, m, d] = (byId('dob').value || '').split('-').map(n => parseInt(n, 10));

    // transform pair list into the structure content.js expects:
    // [{ value: "<text to inject>", text: ["labelKeyword1","labelKeyword2"] }]
    const inputTxtArr = [];
    const kv = JSON.parse(localStorage.getItem('keyValuePairs') || '[]');
    if (kv.length > 0) {
      for (const { key, value } of kv) {
        if (key && value) inputTxtArr.push({ value, text: key.split(',') });
      }
    }

    // checkbox tokens: an array of arrays; UI stores a flat list, pack them 1-per group
    const checkboxTxtArr = [];
    const list = JSON.parse(localStorage.getItem('valueList') || '[]');
    if (list.length > 0) for (const v of list) checkboxTxtArr.push(v.split(','));
    const enabledDays = [...document.querySelectorAll('#days-grid input[type=checkbox]')]
      .filter(cb => cb.checked)
      .map(cb => Number(cb.dataset.day));

    localStorage.setItem('enabledDays', JSON.stringify(enabledDays));
    const payload = {
      firstName: byId('firstName').value,
      lastName : byId('lastName').value,
      email    : byId('email').value,
      phone    : byId('phone').value,
      delayTime: byId('delayTime').value,
      year: y || 0, month: m || 0, day: d || 0,
      submitForm: submitFormToggle.checked,
      inputTxtArr,
      checkboxTxtArr,
      enabledDays,
      includeSpecialEvent: byId('includeSpecialEvent').checked
    };

    chrome.storage.local.set(payload, () => console.log('Data saved:', payload));
    chrome.storage.local.set({ isRunning: true });

    chrome.runtime.sendMessage({ action: 'fillForm', data: payload }, (resp) => {
      console.log('Response from background:', resp);
    });
  });

  stopBtn.addEventListener('click', () => {
    stopBtn.disabled  = true;
    startBtn.disabled = false;
    status.innerText  = 'Ready...';
    console.log('Stop button clicked.');

    chrome.storage.local.set({ isRunning: false });
    chrome.runtime.sendMessage({ action: 'stopFilling' });
  });
});
