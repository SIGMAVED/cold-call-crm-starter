const statusEl = document.getElementById('status');
const retryBtn = document.getElementById('retryBtn');

async function requestMic() {
  retryBtn.classList.add('hidden');
  statusEl.className = '';
  statusEl.innerHTML = 'Waiting for the permission prompt — click <b>Allow</b> when Chrome asks.';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    statusEl.className = 'ok';
    statusEl.textContent = 'Microphone access granted. You can close this tab and start dialing.';
  } catch {
    statusEl.className = 'blocked';
    statusEl.innerHTML =
      'Microphone access is blocked. Click the icon to the left of the address bar above, ' +
      'set Microphone to <b>Allow</b>, then try again.';
    retryBtn.classList.remove('hidden');
  }
}

retryBtn.addEventListener('click', requestMic);
requestMic();
