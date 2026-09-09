import { DAILY_DIAL_GOAL } from './constants.js';

const COLORS = ['#3b82f6', '#4be0a1', '#ffb454', '#ff6b78', '#a294ff'];

// Lightweight, dependency-free confetti burst — spawns a batch of colored
// pieces that fall/spin via CSS animation, then removes itself. No canvas,
// no library; just a handful of absolutely-positioned divs.
export function fireConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  for (let i = 0; i < 90; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const size = 6 + Math.random() * 6;
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.width = `${size}px`;
    piece.style.height = `${size * 0.5}px`;
    piece.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
    piece.style.animationDelay = `${Math.random() * 0.35}s`;
    piece.style.animationDuration = `${1.8 + Math.random() * 1.2}s`;
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 240}px`);
    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 3400);
}

// A full-screen celebratory banner + confetti. Auto-dismisses.
export function celebrate(title, subtitle) {
  fireConfetti();

  const banner = document.createElement('div');
  banner.className = 'celebrate-banner';
  const titleEl = document.createElement('div');
  titleEl.className = 'celebrate-banner-title';
  titleEl.textContent = title;
  banner.appendChild(titleEl);
  if (subtitle) {
    const subEl = document.createElement('div');
    subEl.className = 'celebrate-banner-sub';
    subEl.textContent = subtitle;
    banner.appendChild(subEl);
  }
  document.body.appendChild(banner);
  setTimeout(() => banner.classList.add('is-leaving'), 2600);
  setTimeout(() => banner.remove(), 3200);
}

const guardKey = () => `ccrm_dial_goal_hit_${new Date().toISOString().slice(0, 10)}`;

// Fires the cheer the first time today's dial count reaches the daily goal.
// Guarded in localStorage per calendar day so it fires once — not again on
// call 201, a page reload, or a different logging surface (Session/Queue).
// Returns true if it celebrated.
export function maybeCelebrateDailyGoal(todayDials) {
  if (typeof todayDials !== 'number' || todayDials < DAILY_DIAL_GOAL) return false;
  const key = guardKey();
  if (localStorage.getItem(key)) return false;
  localStorage.setItem(key, '1');
  celebrate(`🎉 ${DAILY_DIAL_GOAL} dials today!`, "That's the daily target crushed. Keep the momentum.");
  return true;
}
