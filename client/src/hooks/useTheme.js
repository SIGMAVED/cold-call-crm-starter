import { useEffect, useState } from 'react';

const THEME_KEY = 'ccrm_theme';

function initialTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  return { theme, toggleTheme };
}
