// popup.js
document.addEventListener('DOMContentLoaded', () => {
  // hydrate basic fields from localStorage with sensible defaults
  const byId = id => document.getElementById(id);

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
  const savedPairs = JSON.parse(localStorage.getItem('keyValuePairs') || '[]');
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

    const payload = {
      firstName: byId('firstName').value,
      lastName : byId('lastName').value,
      email    : byId('email').value,
      phone    : byId('phone').value,
      delayTime: byId('delayTime').value,
      year: y || 0, month: m || 0, day: d || 0,
      submitForm: submitFormToggle.checked,
      inputTxtArr,
      checkboxTxtArr
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
