chrome.action.onClicked.addListener(() => {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  
  chrome.tabs.query({}, (tabs) => {
    const existingTab = tabs.find(tab => tab.url === dashboardUrl);
    if (existingTab) {
      chrome.tabs.update(existingTab.id, { active: true });
    } else {
      chrome.tabs.create({ url: dashboardUrl });
    }
  });
});

