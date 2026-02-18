import en from '../locales/en.js';
import zh from '../locales/zh.js';
import { STORAGE_KEYS } from '../constants.js';

class I18n {
    constructor() {
        this.translations = { en, zh };

        // Priority: 1. Saved preference, 2. System language, 3. Default (zh)
        const savedLocale = localStorage.getItem(STORAGE_KEYS.LOCALE);
        if (savedLocale && this.translations[savedLocale]) {
            this.locale = savedLocale;
        } else {
            const sysLang = navigator.language || navigator.userLanguage || '';
            this.locale = sysLang.startsWith('zh') ? 'zh' : 'en';
        }
    }

    get locale() {
        return this._locale;
    }

    set locale(lang) {
        if (this.translations[lang]) {
            this._locale = lang;
            localStorage.setItem(STORAGE_KEYS.LOCALE, lang);
            document.documentElement.lang = lang;
        }
    }

    t(key, params = {}) {
        if (!key || typeof key !== 'string') return key || '';
        const keys = key.split('.');
        let value = this._getNestedValue(this.translations[this.locale], keys);

        if (value === undefined) {
            // Fallback to English if not found in current locale
            if (this.locale !== 'en') {
                const fallbackValue = this._getNestedValue(this.translations['en'], keys);
                if (fallbackValue !== undefined) return this._interpolate(fallbackValue, params);
            }
            return key;
        }

        return this._interpolate(value, params);
    }

    _getNestedValue(obj, keys) {
        let value = obj;
        for (const k of keys) {
            value = value ? value[k] : undefined;
        }
        return value;
    }

    _interpolate(str, params) {
        return str.replace(/{(\w+)}/g, (match, key) => {
            return typeof params[key] !== 'undefined' ? params[key] : match;
        });
    }

    translatePage() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = this.t(key);
            if (el.tagName === 'INPUT' && el.getAttribute('placeholder')) {
                el.setAttribute('placeholder', translation);
            } else if (el.tagName === 'META') {
                el.setAttribute('content', translation);
            } else if (el.hasAttribute('title') || el.hasAttribute('data-tooltip')) {
                // Use custom tooltip instead of native title
                el.setAttribute('data-tooltip', translation);
                if (el.hasAttribute('title')) el.removeAttribute('title');
                // Also update text content if it's not a button with only icons
                if (el.textContent.trim() !== '' && !el.querySelector('svg')) {
                    el.textContent = translation;
                }
            } else {
                el.textContent = translation;
            }
        });
    }
}

export const i18n = new I18n();
