import { transcriptSocketUrl } from './api.js';

// Subscribes to live transcript lines for a call. `onLine(text, isFinal,
// speaker)` fires for both interim and final Deepgram results; speaker is
// "You" or "Prospect" (one transcription stream per call leg).
export function connectTranscript(callSid, onLine) {
  const ws = new WebSocket(transcriptSocketUrl(callSid));
  ws.onmessage = (evt) => {
    try {
      const { text, isFinal, speaker } = JSON.parse(evt.data);
      onLine(text, isFinal, speaker || '');
    } catch {
      /* ignore malformed frames */
    }
  };
  return ws;
}

export function downloadTranscript(callLabel, lines) {
  const body = lines.join('\n');
  const blob = new Blob([body], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const safeLabel = callLabel.replace(/[^\w-]+/g, '_');
  const filename = `transcript_${safeLabel}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  chrome.downloads.download({ url, filename, saveAs: false }, () => URL.revokeObjectURL(url));
}
