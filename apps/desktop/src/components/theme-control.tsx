import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark' | 'contrast';

const THEME_STORAGE_KEY = 'verify.desktop.theme';

function initialTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'contrast') {
      return stored;
    }
  } catch {
    // Storage can be unavailable in hardened webviews; system theme remains safe.
  }
  return 'system';
}

export function ThemeControl() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    if (theme === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme selection still applies for this session.
    }
  }, [theme]);

  return (
    <label className="theme-control">
      <span>Theme</span>
      <select
        aria-label="Color theme"
        value={theme}
        onChange={(event) => setTheme(event.currentTarget.value as Theme)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="contrast">High contrast</option>
      </select>
    </label>
  );
}
