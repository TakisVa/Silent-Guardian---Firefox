// ---------- STATE ----------
let state = {
  cookiesCleared: 0,
  lastClean: null,
  lastError: null,
  active: false,
  isPremium: false  // Premium status (placeholder: set to true for testing)
};

let whitelist = [];
let blacklist = [];

// Default auto-whitelist for common functional sites (e.g. login-heavy)
const defaultWhitelist = ['google.com', 'hubspot.com', 'amazon.com', 'facebook.com'];  // Add more as needed

// ---------- CONFIG LOADING ----------
async function loadConfigs() {
  const response = await fetch(chrome.runtime.getURL('config/cookie-categories.json'));
  const categories = await response.json();
  const freeBlacklist = [...(categories.free.ads || []), ...(categories.free.tracking || [])];
  blacklist = [...new Set([...blacklist, ...freeBlacklist])];

  if (state.isPremium) {
    const premiumBlacklist = [...(categories.premium.trackers || []), ...(categories.premium.analytics || [])];
    blacklist = [...new Set([...blacklist, ...premiumBlacklist])];
  }
}

// ---------- STORAGE ----------
async function loadState() {
  const data = await chrome.storage.local.get([
    "state",
    "whitelist",
    "blacklist"
  ]);

  if (data.state) state = data.state;
  whitelist = data.whitelist || [...defaultWhitelist];  // Auto-add defaults
  blacklist = data.blacklist || [];

  await loadConfigs();  // Append config blacklist
}

function saveState() {
  chrome.storage.local.set({ state });
}

function saveLists() {
  chrome.storage.local.set({ whitelist, blacklist });
}

// ---------- VALIDATION ----------
function validateDomain(domain) {
  const tldRegex = /\.(com|net|org|io|co|uk|de|fr|gr|eu|app|site)$/i;  // Basic TLD check
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain) && tldRegex.test(domain) && domain !== 'localhost';
}

// ---------- CLEAN LOGIC ----------
async function cleanCookies() {
  try {
    const cookies = await chrome.cookies.getAll({});
    let removed = 0;

    for (const cookie of cookies) {
      let shouldDelete = false;

      const domain = cookie.domain.replace(/^\./, "");

      // Whitelist: NEVER delete
      if (whitelist.some(w => domain.endsWith(w))) continue;

      // Blacklist: ALWAYS delete
      if (blacklist.some(b => domain.endsWith(b))) {
        shouldDelete = true;
      }

      // Heuristics for non-useful cookies
      if (!shouldDelete) {
        if (cookie.hostOnly) continue;
        if (cookie.sameSite !== "no_restriction") continue;

        const nameLower = cookie.name.toLowerCase();
        // Keep useful: login, session, prefs, cart etc.
        if (
          nameLower.includes("sess") ||
          nameLower.includes("auth") ||
          nameLower.includes("token") ||
          nameLower.includes("sid") ||
          nameLower.includes("login") ||
          nameLower.includes("cart") ||
          nameLower.includes("pref") ||
          nameLower.includes("locale") ||
          nameLower.includes("user_id")
        ) {
          continue;
        }

        // Premium extra heuristics: e.g. UUID-like tracking values
        if (state.isPremium && cookie.value.match(/^[a-f0-9-]{36}$/i)) {
          shouldDelete = true;
        }

        shouldDelete = true;  // Default to delete if not useful
      }

      if (!shouldDelete) continue;

      const url = (cookie.secure ? "https://" : "http://") + domain + cookie.path;

      try {
        await chrome.cookies.remove({ url, name: cookie.name });
        removed++;
      } catch (_) {}
    }

    if (removed > 0) {
      state.cookiesCleared += removed;
      state.lastClean = Date.now();
      // Notification for feedback
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Silent Guardian',
        message: `Cleared ${removed} tracking cookies!`
      });
    }

    state.lastError = null;
    saveState();

    return { success: true, removed };
  } catch (e) {
    state.lastError = e.message || "Unknown error";
    saveState();
    return { success: false, error: state.lastError };
  }
}

// ---------- ALARMS ----------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'periodicClean' && state.active) {
    await cleanCookies();
  }
});

// ---------- OPT-OUT LOGIC ----------
async function performBulkOptOut(tabId) {
  try {
    const cmpResponse = await fetch(chrome.runtime.getURL('config/cmp-selectors.json'));
    const cmps = await cmpResponse.json();
    let rejectSelector = cmps.genericCMP.rejectButtonSelector || '.cmp-reject-all';  // Fallback

    if (state.isPremium) {
      const vendorsResponse = await fetch(chrome.runtime.getURL('config/iab-vendors.json'));
      const vendors = await vendorsResponse.json();
      // Premium: Uncheck all non-essential vendors + reject
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (vendorsList, rejectSel) => {
          vendorsList.forEach(v => {
            if (v.purposes.includes('advertising')) {  // Example filter
              const checkbox = document.querySelector(`[data-vendor="${v.id}"] input[type="checkbox"]`);
              if (checkbox && checkbox.checked) checkbox.click();
            }
          });
          const saveBtn = document.querySelector('.cmp-save');
          if (saveBtn) saveBtn.click();
          const rejectBtn = document.querySelector(rejectSel);
          if (rejectBtn) rejectBtn.click();
        },
        args: [vendors, rejectSelector]
      });
    } else {
      // Free: Simple reject button click
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector) => {
          const btn = document.querySelector(selector);
          if (btn) btn.click();
        },
        args: [rejectSelector]
      });
    }

    // Notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Silent Guardian',
      message: 'Opted out from trackers!'
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ---------- MESSAGING ----------
chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  (async () => {
    await loadState();

    if (msg.type === "CLEAN_NOW") {
      const res = await cleanCookies();
      sendResponse({ state, ...res });
      return;
    }

    if (msg.type === "GET_STATE") {
      sendResponse({ state, whitelist, blacklist });
      return;
    }

    if (msg.type === "SMART_PROTECTION") {
      state.active = !state.active;
      if (state.active) {
        chrome.alarms.create('periodicClean', { periodInMinutes: 30 });
      } else {
        chrome.alarms.clear('periodicClean');
      }
      saveState();
      sendResponse({ state });
      return;
    }

    if (msg.type === "BULK_OPT_OUT") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const res = await performBulkOptOut(tab.id);
        sendResponse(res);
      } else {
        sendResponse({ success: false, error: "No active tab" });
      }
      return;
    }

    if (msg.type === "ADD_WHITELIST") {
      const domain = msg.domain.trim();
      if (validateDomain(domain) && !whitelist.includes(domain)) {
        whitelist.push(domain);
        saveLists();
      }
      sendResponse({ whitelist });
      return;
    }

    if (msg.type === "REMOVE_WHITELIST") {
      whitelist = whitelist.filter(d => d !== msg.domain);
      saveLists();
      sendResponse({ whitelist });
      return;
    }

    if (msg.type === "ADD_BLACKLIST") {
      const domain = msg.domain.trim();
      if (validateDomain(domain) && !blacklist.includes(domain)) {
        blacklist.push(domain);
        saveLists();
      }
      sendResponse({ blacklist });
      return;
    }

    if (msg.type === "REMOVE_BLACKLIST") {
      blacklist = blacklist.filter(d => d !== msg.domain);
      saveLists();
      sendResponse({ blacklist });
      return;
    }

    // Placeholder for upgrade (real: integrate payments)
    if (msg.type === "UPGRADE_PREMIUM") {
      state.isPremium = true;  // Test: Set to true
      // Real: Use chrome.payments or webstore API here
      saveState();
      sendResponse({ state });
      return;
    }

    sendResponse({ error: "Unknown message type" });
  })();

  return true;
});

// ---------- INIT ----------
loadState();