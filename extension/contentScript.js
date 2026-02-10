// contentScript.js
(() => {
  const ID = "voice-notes-widget";

  // Prevent double-injection
  if (document.getElementById(ID)) return;

  const iframe = document.createElement("iframe");
  iframe.id = ID;
  iframe.src = chrome.runtime.getURL("widget.html");

  // Position + style
  iframe.style.position = "fixed";
  iframe.style.right = "20px";
  iframe.style.bottom = "20px";
  iframe.style.width = "360px";
  iframe.style.height = "600px";
  iframe.style.border = "none";
  iframe.style.zIndex = "2147483647"; // top-most
  iframe.style.borderRadius = "12px";
  iframe.style.boxShadow = "0 8px 30px rgba(0,0,0,0.25)";

  // Critical: allow mic access inside iframe
  iframe.setAttribute("allow", "microphone; camera; autoplay");

  document.body.appendChild(iframe);
})();
