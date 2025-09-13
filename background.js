// background.js
let isFilling = false;

// Send a message to the currently active tab
function sendMessageToActiveTab(payload) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs.length > 0) {
      chrome.tabs.sendMessage(tabs[0].id, payload);
    }
  });
}

// runtime message bridge between popup and content
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'fillForm') {
    isFilling = true;
    const data = message.data;
    sendMessageToActiveTab({ action: 'startFilling', data });
    return true; // async
  }

  if (message.action === 'stopFilling') {
    isFilling = false;
    // call stopFill in the active tab so the content loop stops
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          function: () => { window.isFilling = false; },
        },
        () => sendResponse({ success: true })
      );
    });
    return true; // async
  }
});
