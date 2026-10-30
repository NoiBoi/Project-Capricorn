// Keep recovery independent of the main UI bundle and the preload bridge.
let ready = false;
let timer: ReturnType<typeof setTimeout>;
function recover() {
  if (ready) return;
  const view = document.getElementById('view');
  if (!view) return;
  view.replaceChildren();
  const box = document.createElement('div'); box.className = 'scroll';
  const text = document.createElement('p'); text.textContent = 'Settings could not finish loading. Your saved data is safe.';
  const retry = document.createElement('button'); retry.className = 'btn'; retry.textContent = 'Reload settings'; retry.onclick = () => location.reload();
  const close = document.createElement('button'); close.className = 'btn'; close.textContent = 'Close window'; close.onclick = () => window.close();
  box.append(text, retry, close); view.append(box);
}
window.addEventListener('capri:panel-ready', () => { ready = true; clearTimeout(timer); });
window.addEventListener('error', recover);
window.addEventListener('unhandledrejection', recover);
document.getElementById('closeBtn')?.addEventListener('click', () => window.close());
timer = setTimeout(recover, 6000);
