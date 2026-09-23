/* One deploy-wide cover background, shared by all pages. */
(() => {
  async function applyBackground() {
    const response = await fetch("/config/site.json", { cache: "no-cache" });
    if (!response.ok) return;
    const theme = (await response.json()).theme || {};
    for (const [key, variable] of Object.entries({ accent: "--accent", background: "--background" })) {
      if (/^#[0-9a-f]{6}$/i.test(theme[key] || "")) document.documentElement.style.setProperty(variable, theme[key]);
    }
    let image = theme.backgroundImage;
    if (!image && Array.isArray(theme.backgroundImages) && theme.backgroundImages.length) {
      const selected = await fetch("/config/selected-background.json", { cache: "no-cache" });
      if (selected.ok) {
        const choice = (await selected.json()).image;
        if (theme.backgroundImages.includes(choice)) image = choice;
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
  applyBackground().catch(() => { /* Plain color remains usable offline. */ });
})();
