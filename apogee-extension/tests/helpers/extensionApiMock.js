// Headless WebExtensions API mock environment for unit testing.
// Mocks chrome.storage, chrome.runtime, chrome.tabs, and chrome.permissions in Node.js.

// Shared add/removeListener pair for the mock event surfaces below: same
// array, same removal, only the listener list differs.
function createListenerList() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    },
  };
}

export function createExtensionApiMock(initialStorage = {}) {
  const storageData = { ...initialStorage };
  const messageListeners = createListenerList();
  const storageChangeListeners = createListenerList();

  const mockStorage = {
    local: {
      get: async (keys) => {
        if (!keys) return { ...storageData };
        if (typeof keys === "string") {
          return { [keys]: storageData[keys] };
        }
        if (Array.isArray(keys)) {
          const result = {};
          keys.forEach((k) => {
            if (k in storageData) result[k] = storageData[k];
          });
          return result;
        }
        if (typeof keys === "object") {
          const result = {};
          Object.keys(keys).forEach((k) => {
            result[k] = k in storageData ? storageData[k] : keys[k];
          });
          return result;
        }
        return { ...storageData };
      },
      set: async (items) => {
        const changes = {};
        Object.entries(items).forEach(([k, v]) => {
          changes[k] = { oldValue: storageData[k], newValue: v };
          storageData[k] = v;
        });
        storageChangeListeners.listeners.forEach((fn) => fn(changes, "local"));
      },
      remove: async (keys) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach((k) => delete storageData[k]);
      },
      clear: async () => {
        Object.keys(storageData).forEach((k) => delete storageData[k]);
      },
    },
    onChanged: {
      addListener: storageChangeListeners.addListener,
      removeListener: storageChangeListeners.removeListener,
    },
  };

  const mockRuntime = {
    id: "mock-extension-id-12345",
    getManifest: () => ({ version: "0.2.1", name: "Apogee" }),
    getURL: (path) => `chrome-extension://mock-extension-id-12345/${path}`,
    sendMessage: async (msg) => {
      let response;
      for (const listener of messageListeners.listeners) {
        const sendResponse = (res) => {
          response = res;
        };
        const result = listener(msg, { id: mockRuntime.id }, sendResponse);
        if (result === true) {
          // async response handled via sendResponse
        }
      }
      return response;
    },
    onMessage: {
      addListener: messageListeners.addListener,
      removeListener: messageListeners.removeListener,
    },
  };

  const mockTabs = {
    query: async (_queryInfo) => {
      return [
        {
          id: 101,
          url: "https://example.com/article",
          title: "Example Test Article",
          active: true,
          highlighted: true,
          windowId: 1,
        },
      ];
    },
    sendMessage: async (_tabId, _msg) => {
      return {
        text: "Extracted article text content",
        title: "Example Test Article",
      };
    },
  };

  const mockPermissions = {
    contains: async (_perm) => true,
    request: async (_perm) => true,
  };

  return {
    chrome: {
      storage: mockStorage,
      runtime: mockRuntime,
      tabs: mockTabs,
      permissions: mockPermissions,
    },
    getStorageData: () => ({ ...storageData }),
  };
}
