/**
 * 主题管理模块
 * @module theme-manager
 */

export const THEMES = [
    { id: 'default', name: '默认', icon: '✦', color: '#8b2c3b' },
    { id: 'forest', name: '森林', icon: '🌲', color: '#355F2E' },
    { id: 'ocean', name: '海洋', icon: '🌊', color: '#133E87' },
    { id: 'lavender', name: '薰衣草', icon: '💜', color: '#52357B' },
    { id: 'mono', name: '黑白', icon: '◐', color: '#6b6b6b' }
];

export const COLOR_SCHEME_MODES = [
    { id: 'auto', name: '自动', icon: '◐' },
    { id: 'light', name: '亮色', icon: '☀️' },
    { id: 'dark', name: '暗色', icon: '🌙' }
];

const THEME_STORAGE_KEY = 'tidyflux-theme';
const COLOR_SCHEME_STORAGE_KEY = 'tidyflux-color-scheme';

function getCurrentTheme() {
    return localStorage.getItem(THEME_STORAGE_KEY) || 'default';
}

function getCurrentColorScheme() {
    return localStorage.getItem(COLOR_SCHEME_STORAGE_KEY) || 'auto';
}

export function setTheme(themeId) {
    const html = document.documentElement;

    if (themeId === 'default') {
        html.removeAttribute('data-theme');
    } else {
        html.setAttribute('data-theme', themeId);
    }

    localStorage.setItem(THEME_STORAGE_KEY, themeId);

    updateThemeColorMeta();
}

export function setColorScheme(mode) {
    const html = document.documentElement;

    html.removeAttribute('data-color-scheme');

    if (mode === 'light') {
        html.setAttribute('data-color-scheme', 'light');
    } else if (mode === 'dark') {
        html.setAttribute('data-color-scheme', 'dark');
    }

    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, mode);

    updateThemeColorMeta();
}



function updateThemeColorMeta() {
    const style = getComputedStyle(document.documentElement);
    const bgColor = style.getPropertyValue('--bg-color').trim();

    const lightMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: light)"]');
    const darkMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]');

    if (lightMeta) lightMeta.setAttribute('content', bgColor);
    if (darkMeta) darkMeta.setAttribute('content', bgColor);
}

export function initTheme() {
    const savedTheme = getCurrentTheme();
    if (savedTheme && savedTheme !== 'default') {
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    const savedColorScheme = getCurrentColorScheme();
    if (savedColorScheme && savedColorScheme !== 'auto') {
        document.documentElement.setAttribute('data-color-scheme', savedColorScheme);
    }

    requestAnimationFrame(() => {
        updateThemeColorMeta();
    });
}
