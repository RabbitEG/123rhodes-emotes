/* Choose a cover on each page load, including refresh and navigation. */
(() => {
  let theme = {};
  function rotate() {
    let image = theme.backgroundImage;
    if (!image && Array.isArray(theme.backgroundImages) && theme.backgroundImages.length) {
      const choices = theme.backgroundImages.filter(path =>
        typeof path === "string" && /^\/media\/backgrounds\/[0-9a-f]{16}-[0-9a-f]{16}\.webp$/.test(path)
      );
      if (choices.length) {
        let previous = "";
        try { previous = sessionStorage.getItem("last-cover") || ""; } catch { /* Storage may be disabled. */ }
        const pool = choices.length > 1 ? choices.filter(path => path !== previous) : choices;
        const random = new Uint32Array(1);
        crypto.getRandomValues(random);
        image = pool[random[0] % pool.length];
        try { sessionStorage.setItem("last-cover", image); } catch { /* Still rotate this page. */ }
      }
    }
    if (typeof image !== "string") return;
    const url = new URL(image, location.origin);
    if (url.origin !== location.origin || !(
      /^\/assets\/[^?#]+\.(webp|png|jpe?g|svg)$/i.test(url.pathname) ||
      /^\/media\/backgrounds\/[0-9a-f]{16}-[0-9a-f]{16}\.webp$/.test(url.pathname)
    )) return;
    document.documentElement.style.setProperty("--site-background", 'url("' + url.href + '")');
  }
  window.RhodesBackground = { rotate };
  async function applyBackground() {
    const response = await fetch("/config/site.json", { cache: "no-cache" });
    if (!response.ok) return;
    theme = (await response.json()).theme || {};
    for (const [key, variable] of Object.entries({ accent: "--accent", background: "--background" })) {
      if (/^#[0-9a-f]{6}$/i.test(theme[key] || "")) document.documentElement.style.setProperty(variable, theme[key]);
    }
    rotate();
  }
  applyBackground().catch(() => { /* Plain color remains usable offline. */ });
})();
