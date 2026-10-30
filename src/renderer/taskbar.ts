import type { CapriApi } from '../preload/preload';
import type { TaskbarCommand } from '../main/taskbar';
const api = (window as unknown as { capri: CapriApi }).capri;
function renderMode(mode: string) {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  document.getElementById('mode-hint')!.textContent = mode === 'sleep' ? 'Resting here. Wandering and unsolicited chatter are off.' : mode === 'explore' ? 'Visiting windows, taking a look, then settling in.' : 'Keeping you company. Your usual preferences apply.';
}
const refreshMode = () => void api.invoke('taskbar:mode').then(renderMode);
refreshMode(); window.addEventListener('focus', refreshMode);
api.on('companion:mode', mode => renderMode(String(mode)));
document.querySelectorAll<HTMLButtonElement>('button[data-command]').forEach(button => button.addEventListener('click', () => {
  void api.invoke('taskbar:command', button.dataset.command as TaskbarCommand).then(() => refreshMode()).catch(error => { document.getElementById('error')!.textContent = String(error.message); });
}));
