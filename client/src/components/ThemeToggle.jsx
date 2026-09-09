import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme.js';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button className="theme-toggle" onClick={toggleTheme}>
      {isDark ? <Moon size={16} /> : <Sun size={16} />}
      {isDark ? 'Dark mode' : 'Light mode'}
    </button>
  );
}
