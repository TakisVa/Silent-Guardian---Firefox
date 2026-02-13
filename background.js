// ---------- STATE ----------
let state = {
  cookiesCleared: 0,
  lastClean: null,
  lastError: null,
  active: false
};

let whitelist = [];
let blacklist = [];

const defaultWhitelist = ['google.com', 'amazon.com', 'facebook.com', 'hubspot.com'];

// ---------- CONFIG LOADING ----------
async function loadConfigs() {
  try {
    const response = await fetch(chrome.runtime.getURL('config/cookie-categories.json'));
    const categories = await response.json();
    const freeBlacklist = [...(categories.free.ads || []), ...(categories.free.tracking || [])];
    blacklist = [...new Set([...blacklist, ...freeBlacklist])];
  } catch (e) {
    console.error("Config load error:", e);
  }
}

// ---------- STORAGE ----------
async function loadState() {
  try {
    const data = await chrome.storage.local.get(["state", "whitelist", "blacklist"]);
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
  chrome.storage.local.set({ state });
}

function saveLists() {
  chrome.storage.local.set({ whitelist, blacklist });
}

// ---------- VALIDATION ----------
function validateDomain(domain) {
  domain = domain.toLowerCase();
  const tldRegex = /\.(com|net|org|io|co|uk|de|fr|gr|eu|app|site|ai|dev|biz|info|me|tv)$/i;
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain) && tldRegex.test(domain) && domain !== 'localhost';
}

// ---------- CLEAN LOGIC ----------
async function cleanCookies() {
  try {
    const cookies = await chrome.cookies.getAll({});
    let removed = 0;

    for (const cookie of cookies) {
      let shouldDelete = false;
      const domain = cookie.domain.replace(/^\./, "").toLowerCase();

      if (whitelist.some(w => domain.endsWith(w))) continue;
      if (blacklist.some(b => domain.endsWith(b))) shouldDelete = true;

      if (!shouldDelete) {
        if (cookie.hostOnly) continue;
        if (cookie.sameSite !== "no_restriction") continue;

        const nameLower = cookie.name.toLowerCase();
        if (nameLower.includes("sess") || nameLower.includes("auth") || 
            nameLower.includes("token") || nameLower.includes("sid") ||
            nameLower.includes("login") || nameLower.includes("cart") ||
            nameLower.includes("pref") || nameLower.includes("locale") ||
            nameLower.includes("user_id")) {
          continue;
        }
        shouldDelete = true;
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
    }

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

    const vendorsResponse = await fetch(chrome.runtime.getURL('config/iab-vendors.json'));
    const vendors = await vendorsResponse.json();

    await chrome.scripting.executeScript({
      target: { tabId },
      func: (vendorsList, selectors) => {
        let clicked = false;

        vendorsList.forEach(v => {
          if (!v.purposes.includes("strictly_necessary")) {
            const selectorsToTry = [
              `[data-vendor-id="${v.id}"] input[type="checkbox"]`,
              `input[data-vendor="${v.id}"]`,
              `input[name*="${v.id}"]`
            ];
            for (const sel of selectorsToTry) {
              const el = document.querySelector(sel);
              if (el && el.checked) {
                el.click();
                clicked = true;
                break;
              }
            }
          }
        });

        const saveSelectors = selectors.commonSaveButtons || [".save-preferences-btn", ".ot-pc-save", ".cmp-save"];
        for (const sel of saveSelectors) {
          const btn = document.querySelector(sel);
          if (btn) {
            btn.click();
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          const rejectBtn = document.querySelector(selectors.genericCMP.rejectButtonSelector);
          if (rejectBtn) rejectBtn.click();
        }
      },
      args: [vendors, cmps]
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
      if (state.active) chrome.alarms.create('periodicClean', { periodInMinutes: 30 });
      else chrome.alarms.clear('periodicClean');
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

    // Add / Remove handlers (ίδιοι με Chrome)
    if (msg.type === "ADD_WHITELIST") {
      let domain = msg.domain.trim().toLowerCase();
      if (blacklist.includes(domain)) {
        sendResponse({ error: "This domain is already in Blacklist!" });
        return;
      }
      if (validateDomain(domain) && !whitelist.includes(domain)) {
        whitelist.push(domain);
        saveLists();
      }
      sendResponse({ whitelist });
      return;
    }

    // ... (τα υπόλοιπα ADD/REMOVE ίδια όπως στο Chrome)

    sendResponse({ error: "Unknown message type" });
  })();

  return true;
});

loadState();