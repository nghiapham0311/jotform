// inject.js - injects content.js into the page context
function injectScript(srcUrl, whereTagName = 'body') {
  const parent = document.getElementsByTagName(whereTagName)[0];
  const script = document.createElement('script');
  script.setAttribute('type', 'text/javascript');
  script.setAttribute('src', srcUrl);
  parent.appendChild(script);
}

injectScript(chrome.extension.getURL('content.js'), 'body');
