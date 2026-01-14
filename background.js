// ---------- STATE ----------
let state = {
  cookiesCleared: 0,
  lastClean: null,
  lastError: null,
  active: false,
  isPremium: false
};

let whitelist = [];
let blacklist = [];

// Default auto-whitelist
const defaultWhitelist = ['google.com', 'amazon.com', 'facebook.com', 'hubspot.com'];

// ---------- CONFIG LOADING ----------
async function loadConfigs() {
  try {
    const response = await fetch(chrome.runtime.getURL('config/cookie-categories.json'));
    const categories = await response.json();
    const freeBlacklist = [...(categories.free.ads || []), ...(categories.free.tracking || [])];
    blacklist = [...new Set([...blacklist, ...freeBlacklist])];

    if (state.isPremium) {
      const premiumBlacklist = [...(categories.premium.trackers || []), ...(categories.premium.analytics || [])];
      blacklist = [...new Set([...blacklist, ...premiumBlacklist])];
    }
  } catch (e) {
    console.error("Config load error:", e);
  }
}

// ---------- STORAGE ----------
async function loadState() {
  try {
    const storedData = await chrome.storage.local.get(["state", "whitelist", "blacklist"]);
    console.log("Loaded storage data:", storedData);

    const data = storedData || {};

    if (data.state) state = data.state;
    whitelist = data.whitelist || [...defaultWhitelist];
    blacklist = data.blacklist || [];

    await loadConfigs();
  } catch (e) {
    console.error("Storage load error:", e);
    whitelist = [...defaultWhitelist];
    blacklist = [];
  }
}

function saveState() {
  chrome.storage.local.set({ state }).catch(e => console.error("Save state error:", e));
}

function saveLists() {
  chrome.storage.local.set({ whitelist, blacklist }).catch(e => console.error("Save lists error:", e));
}

// ---------- VALIDATION ----------
function validateDomain(domain) {
  domain = domain.toLowerCase();
  const tldRegex = /\.(com|net|org|io|co|uk|de|fr|gr|eu|app|site|ai|dev|biz|info)$/i;  // Expanded TLDs
  const isValid = /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain) && tldRegex.test(domain) && domain !== 'localhost';
  console.log("Validate domain:", domain, "Result:", isValid);
  return isValid;
}

// ---------- CLEAN LOGIC ----------
async function cleanCookies() {
  console.log("Starting cleanCookies...");
  try {
    const cookies = await chrome.cookies.getAll({});
    console.log("Fetched cookies:", cookies.length);

    let removed = 0;

    for (const cookie of cookies) {
      let shouldDelete = false;

      const domain = cookie.domain.replace(/^\./, "").toLowerCase();

      if (whitelist.some(w => domain.endsWith(w))) continue;

      if (blacklist.some(b => domain.endsWith(b))) {
        shouldDelete = true;
      }

      if (!shouldDelete) {
        if (cookie.hostOnly) continue;
        if (cookie.sameSite !== "no_restriction") continue;

        const nameLower = cookie.name.toLowerCase();
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

        if (state.isPremium && cookie.value.match(/^[a-f0-9-]{36}$/i)) {
          shouldDelete = true;
        }

        shouldDelete = true;
      }

      if (!shouldDelete) continue;

      const url = (cookie.secure ? "https://" : "http://") + domain + cookie.path;

      try {
        await chrome.cookies.remove({ url, name: cookie.name });
        removed++;
        console.log("Removed cookie:", cookie.name, "from", domain);
      } catch (e) {
        console.error("Remove error for", cookie.name, ":", e);
      }
    }

    if (removed > 0) {
      state.cookiesCleared += removed;
      state.lastClean = Date.now();
      // Remove notification - keep silent
    } else {
      console.log("No cookies removed.");
    }

    state.lastError = null;
    saveState();

    return { success: true, removed };
  } catch (e) {
    console.error("cleanCookies error:", e);
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
  console.log("Starting performBulkOptOut for tab:", tabId);  // Debug
  try {
    const cmpResponse = await fetch(chrome.runtime.getURL('config/cmp-selectors.json'));
    const cmps = await cmpResponse.json();
    let rejectSelector = cmps.genericCMP.rejectButtonSelector || '.cmp-reject-all';

    if (state.isPremium) {
      const vendorsResponse = await fetch(chrome.runtime.getURL('config/iab-vendors.json'));
      const vendors = await vendorsResponse.json();
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (vendorsList, rejectSel) => {
          vendorsList.forEach(v => {
            if (v.purposes.includes('advertising')) {
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
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector) => {
          const btn = document.querySelector(selector);
          if (btn) btn.click();
        },
        args: [rejectSelector]
      });
    }

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Silent Guardian',
      message: 'Opted out from trackers!'
    });

    return { success: true };
  } catch (e) {
    console.error("performBulkOptOut error:", e);
    return { success: false, error: e.message };
  }
}

// ---------- MESSAGING ----------
chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
  (async () => {
    await loadState();

    console.log("Received message:", msg);

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
      const domain = msg.domain.trim().toLowerCase();
      if (blacklist.includes(domain)) {
        sendResponse({ whitelist, error: "Domain is already in blacklist!" });
        return;
      }
      if (validateDomain(domain) && !whitelist.includes(domain)) {
        whitelist.push(domain);
        saveLists();
      }
      sendResponse({ whitelist });
      return;
    }

    if (msg.type === "REMOVE_WHITELIST") {
      whitelist = whitelist.filter(d => d !== msg.domain.toLowerCase());
      saveLists();
      sendResponse({ whitelist });
      return;
    }

    if (msg.type === "ADD_BLACKLIST") {
      const domain = msg.domain.trim().toLowerCase();
      if (whitelist.includes(domain)) {
        sendResponse({ blacklist, error: "Domain is already in whitelist!" });
        return;
      }
      if (validateDomain(domain) && !blacklist.includes(domain)) {
        blacklist.push(domain);
        saveLists();
      }
      sendResponse({ blacklist });
      return;
    }

    if (msg.type === "REMOVE_BLACKLIST") {
      blacklist = blacklist.filter(d => d !== msg.domain.toLowerCase());
      saveLists();
      sendResponse({ blacklist });
      return;
    }

    if (msg.type === "UPGRADE_PREMIUM") {
      state.isPremium = true;
      saveState();
      sendResponse({ state });
      return;
    }

    console.error("Unknown message type:", msg.type);
    sendResponse({ error: "Unknown message type" });
  })();

  return true;
});

// ---------- INIT ----------
loadState();