(function (App) {
  'use strict';

  App.apiCall = async function (payload, opts) {
    opts = opts || {};
    const retries = opts.retries || 0;
    const timeout = opts.timeout || 20000;
    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(App.WEB_APP_URL, {
          method: 'POST',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
        clearTimeout(timer);

        const text = await response.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error("Non-JSON response from server:", text);
          return { success: false, message: "Server returned invalid format. Check Apps Script deployment access." };
        }
      } catch (error) {
        clearTimeout(timer);
        lastErr = error;
        if (attempt === retries) break;
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }

    const message = (lastErr && lastErr.name === 'AbortError')
      ? 'Request timed out. Please try again.'
      : ((lastErr && lastErr.message) || 'Network error.');
    return { success: false, message: message };
  };

})(window.App);