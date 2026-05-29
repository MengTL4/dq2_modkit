(function () {
  try {
    const script = document.createElement("script");
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", chrome.runtime.getURL("page-bridge.js"), false);
      xhr.send(null);
      if (xhr.status === 200 || xhr.status === 0) {
        script.textContent = xhr.responseText + "\n//# sourceURL=codex-local-trainer-bridge.js";
      } else {
        script.src = chrome.runtime.getURL("page-bridge.js");
      }
    } catch (_) {
      script.src = chrome.runtime.getURL("page-bridge.js");
    }
    script.onload = function () {
      this.remove();
    };
    (document.documentElement || document.head || document.body).appendChild(script);
  } catch (error) {
    console.error("[codex-bridge] content injection failed", error);
  }
})();
