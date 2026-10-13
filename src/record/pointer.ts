export interface PointerOptions {
  color: string;
  hide: string[];
}

/**
 * Source of the script injected into every page before the site's own scripts. It draws a
 * fingertip dot that glides between targets, a ripple on every tap, and hides selectors such
 * as cookie banners. It is plain JavaScript text on purpose: a TypeScript function passed to
 * the browser would carry whatever helpers the transpiler added, and those do not exist there.
 * The page gets `window.__rf.move(x, y, ms)` and `window.__rf.tap(x, y)`.
 */
export function pointerScript({ color, hide }: PointerOptions): string {
  const css =
    hide.map((selector) => `${selector}{display:none!important}`).join("") +
    "@keyframes __rf-ripple{from{transform:translate(-50%,-50%) scale(.3);opacity:.9}" +
    "to{transform:translate(-50%,-50%) scale(2.6);opacity:0}}";
  return `(() => {
  const color = ${JSON.stringify(color)};
  const mount = () => {
    const root = document.documentElement;
    if (!root || document.getElementById("__rf-pointer")) return;
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(css)};
    root.appendChild(style);
    const dot = document.createElement("div");
    dot.id = "__rf-pointer";
    dot.style.cssText = "position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;" +
      "border-radius:50%;background:" + color + "88;border:4px solid #fff;" +
      "box-shadow:0 2px 10px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;" +
      "opacity:0;transform:translate(50vw,70vh)";
    root.appendChild(dot);
  };
  // The script can run before <html> exists; DOMContentLoaded mounts it then.
  document.addEventListener("DOMContentLoaded", mount);
  mount();
  window.__rf = {
    move(x, y, ms) {
      const dot = document.getElementById("__rf-pointer");
      if (!dot) return;
      dot.style.opacity = "1";
      dot.style.transition = "transform " + ms + "ms cubic-bezier(.3,.7,.2,1)";
      dot.style.transform = "translate(" + x + "px," + y + "px)";
    },
    tap(x, y) {
      const ripple = document.createElement("div");
      ripple.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:84px;height:84px;" +
        "border-radius:50%;border:5px solid " + color + ";z-index:2147483646;pointer-events:none;" +
        "animation:__rf-ripple .6s ease-out forwards";
      document.documentElement.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    },
  };
})();`;
}
