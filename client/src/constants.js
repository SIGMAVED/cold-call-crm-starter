export const PRIORITIES = ['Hot', 'Warm', 'Cold'];

export const ROLES = ['Gatekeeper', 'Owner', 'AI'];

export const TARGET_METRICS = [
  { value: 'dials', label: 'Dials' },
  { value: 'conversations', label: 'Conversations' },
  // Counts distinct leads whose role is Owner — see the note in
  // routes/targets.js on why this can't be a per-call count.
  { value: 'owner_conversations', label: 'Owner Conversations' },
];

// Dials logged in a single day that trigger the celebration. Recurring/
// daily, distinct from the date-range Targets in Settings.
export const DAILY_DIAL_GOAL = 200;

export const PRIORITY_COLORS = {
  Hot: '#ff5a5f',
  Warm: '#f5a623',
  Cold: '#4a90d9',
};

export const SCRIPT = {
  opener: [
    "Hey — I was just wondering, what time do you guys close today?",
    "Got it. If I call after [time], does it go to voicemail, or is someone still picking up?",
    "I was actually calling to see how you guys handle those after-hours calls.",
    "Have you considered using an AI voice agent to capture those calls?"
  ],
  qualify: "Got it — and are you the one who'd make the call on something like that, or is that the owner?",
  ask: [
    "Would you be open to a quick 15-minute look at how it actually sounds? I could do tomorrow morning.",
    "Can I text you a number right now? Call it, talk to it like a customer with a broken AC — sixty seconds."
  ],
  objections: [
    { trigger: "We already have an answering service", response: "Does it actually book the job, or just take a message?" },
    { trigger: "We use Housecall Pro", response: "Perfect — this sits on top of it. Worth 15 min to compare?" },
    { trigger: "We don't do emergency/after-hours", response: "Fair enough — what about overflow during the summer rush?" },
    { trigger: "What's this about?", response: "I'll be honest, this is a cold call — 30 seconds, hang up if it's not relevant." },
    { trigger: "Send me some info", response: "I can, but a PDF won't tell you how it sounds — give me your mobile, I'll text the live number." }
  ],
  lockIn: "Perfect — [day] at [time]? What's the best email? I'll send a calendar invite so it's on your diary.",
  offer: {
    text: "Fourteen days, free, on your actual after-hours calls. No contract. I'll waive the setup fee — normally $300.",
    reason: "I'm building HVAC case studies right now — I want three companies I can point to."
  }
};
