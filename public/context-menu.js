// Native injection also runs this in child frames. The guard avoids installing
// a second listener when the main page loads the same script from its HTML.
(() => {
  const key = Symbol.for("devyy.context-menu-policy");
  if (window[key]) return;
  window[key] = true;
  // Prevent the WebView's default action without blocking Devyy or extension
  // handlers further along the event path.
  document.addEventListener(
    "contextmenu",
    (event) => event.preventDefault(),
    true,
  );
})();
