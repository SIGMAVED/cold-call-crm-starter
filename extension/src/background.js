// Clicking the toolbar icon opens the dialer docked in Chrome's side panel,
// so it stays pinned alongside whatever tab you're on (CRM, LinkedIn, maps…)
// instead of floating in its own window.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
