chrome.action.onClicked.addListener(async tab => {
  const url = chrome.runtime.getURL("preview.html") + "#" + tab.id;
  await chrome.tabs.create({url, openerTabId:tab.id});
});
