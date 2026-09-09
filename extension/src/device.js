import { Device } from '@twilio/voice-sdk';
import { api } from './api.js';

let device = null;
let activeCall = null;
let incomingHandler = null;

// Register a callback fired when Twilio rings this browser for an inbound
// call. Set this before ensureDevice() so no early incoming call is missed.
export function onIncomingCall(handler) {
  incomingHandler = handler;
}

export async function ensureDevice() {
  if (device) return device;
  const { token } = await api.getTwilioToken();
  device = new Device(token, { codecPreferences: ['opus', 'pcmu'] });
  device.on('tokenWillExpire', async () => {
    const { token: fresh } = await api.getTwilioToken();
    device.updateToken(fresh);
  });
  device.on('error', (err) => console.error('Twilio Device error:', err.message));
  device.on('incoming', (call) => { incomingHandler?.(call); });
  await device.register();
  return device;
}

// Accept a ringing inbound call and wire it into the same status lifecycle
// placeCall uses, so the popup can drive one shared call overlay.
export function answerIncoming(call, { onStatusChange, onCallSid } = {}) {
  activeCall = call;
  call.on('accept', () => {
    onStatusChange?.('in-progress');
    if (call.parameters?.CallSid) onCallSid?.(call.parameters.CallSid);
  });
  call.on('disconnect', () => { activeCall = null; onStatusChange?.('ended'); });
  call.on('cancel', () => { activeCall = null; onStatusChange?.('ended'); });
  call.on('error', (err) => onStatusChange?.('error', err));
  call.accept();
}

// Decline a ringing inbound call — Twilio's <Dial> then falls through to
// voicemail (see /twilio/inbound-fallback).
export function rejectIncoming(call) {
  call.reject();
}

// Places an outbound call. `onStatusChange('ringing' | 'in-progress' | 'ended' | 'error', err?)`
// fires as the call progresses; `onCallSid(sid)` fires as soon as the SID is known
// (needed to open the transcript WebSocket).
export async function placeCall(toNumber, { onStatusChange, onCallSid } = {}) {
  const dev = await ensureDevice();
  const call = await dev.connect({ params: { To: toNumber } });
  activeCall = call;

  call.on('ringing', () => onStatusChange?.('ringing'));
  call.on('accept', () => {
    onStatusChange?.('in-progress');
    if (call.parameters?.CallSid) onCallSid?.(call.parameters.CallSid);
  });
  call.on('disconnect', () => {
    activeCall = null;
    onStatusChange?.('ended');
  });
  call.on('cancel', () => {
    activeCall = null;
    onStatusChange?.('ended');
  });
  call.on('error', (err) => onStatusChange?.('error', err));

  // parameters.CallSid is often already populated right after connect(),
  // even before 'accept' fires.
  if (call.parameters?.CallSid) onCallSid?.(call.parameters.CallSid);

  return call;
}

export function hangUp() {
  activeCall?.disconnect();
}

export function sendDigits(digit) {
  activeCall?.sendDigits(digit);
}

// Toggles the mic on the active call; returns the new muted state.
export function toggleMute() {
  if (!activeCall) return false;
  const next = !activeCall.isMuted();
  activeCall.mute(next);
  return next;
}
