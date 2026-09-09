import WebSocket from 'ws';

// nova-3 handles 8kHz mulaw phone audio far better than the default model;
// smart_format fixes numbers, punctuation, and casing.
const DEEPGRAM_URL =
  'wss://api.deepgram.com/v1/listen?model=nova-3&encoding=mulaw&sample_rate=8000&channels=1&interim_results=true&smart_format=true&endpointing=300';

// Opens one Deepgram live-transcription connection for ONE Twilio media
// track. Each call opens two of these (agent + prospect) — mixing both
// tracks into a single mono stream garbles the audio chunk-by-chunk and
// wrecks accuracy.
export function createDeepgramConnection({ onTranscript }) {
  const ws = new WebSocket(DEEPGRAM_URL, {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
  });
  const queue = [];
  let open = false;

  ws.on('open', () => {
    open = true;
    for (const chunk of queue.splice(0)) ws.send(chunk);
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const alt = msg.channel?.alternatives?.[0];
    if (alt?.transcript) onTranscript(alt.transcript, !!msg.is_final);
  });

  ws.on('error', (err) => console.error('Deepgram WS error:', err.message));

  return {
    sendAudio(buf) {
      if (open && ws.readyState === WebSocket.OPEN) ws.send(buf);
      else queue.push(buf);
    },
    close() {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'CloseStream' }));
        } catch {
          /* already closing */
        }
      }
      ws.close();
    },
  };
}
