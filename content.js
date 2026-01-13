// Content script to detect CMP presence and notify background if needed
// (For future enhancements, e.g. auto-opt-out trigger - placeholder for now)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CHECK_CMP") {
    const cmpElements = document.querySelectorAll('.cmp-popup, .cookie-banner');  // Example selectors
    sendResponse({ hasCMP: cmpElements.length > 0 });
  }
  return true;
});