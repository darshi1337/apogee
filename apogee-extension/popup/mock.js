if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
  window.chrome = {
    runtime: {
      onMessage: {
        addListener: (listener) => {
          window.addEventListener("message", (event) => {
            if (event.data && event.data.type) {
              listener(event.data);
            }
          });
        },
      },
      sendMessage: (msg, callback) => {
        if (msg.action === "check-webgpu") {
          setTimeout(() => callback({ supported: true }), 0);
        } else if (msg.action === "status") {
          setTimeout(() => callback({ ready: true }), 0);
        } else {
          setTimeout(() => callback({ ready: true }), 0);
        }
      },
      connect: () => ({
        onMessage: { addListener: () => {} },
        onDisconnect: { addListener: () => {} },
        disconnect: () => {},
      }),
      lastError: null,
    },
    storage: {
      local: {
        get: async (keys) => {
          const settings = JSON.parse(localStorage.getItem("settings") || "{}");
          if (keys === null) return { settings };
          if (typeof keys === "string") return { [keys]: settings[keys] };
          if (Array.isArray(keys)) {
            const res = {};
            keys.forEach((k) => (res[k] = settings[k]));
            return res;
          }
          return { settings };
        },
        set: async (obj) => {
          const settings = JSON.parse(localStorage.getItem("settings") || "{}");
          Object.assign(settings, obj.settings || obj);
          localStorage.setItem("settings", JSON.stringify(settings));
        },
        remove: async (keys) => {},
      },
    },
    tabs: {
      query: async () => [
        { id: 1, url: "https://example.com", title: "Example Page" },
      ],
    },
    scripting: {
      executeScript: async () => [
        {
          result: {
            title: "Example Page",
            content: "This is mock content of the active page to demonstrate Apogee.",
            url: "https://example.com",
          },
        },
      ],
    },
  };
}
