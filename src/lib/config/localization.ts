/**
 * Localization Configuration
 *
 * This module defines all language-related settings for the CMS.
 * Modify this file to add, remove, or update available languages.
 *
 * This file can be safely imported in both client and server code.
 */

export interface Language {
    code: string;
    name: string;
    nativeName: string;
}

/**
 * Available languages in the CMS
 * Add or remove languages here to update the entire system
 */
export const AVAILABLE_LANGUAGES: Language[] = [
    {
        code: "en",
        name: "English",
        nativeName: "English",
    },
    {
        code: "zh-TW",
        name: "Traditional Chinese",
        nativeName: "繁體中文",
    },
    {
        code: "zh-CN",
        name: "Simplified Chinese",
        nativeName: "简体中文",
    },
    {
        code: "ja",
        name: "Japanese",
        nativeName: "日本語",
    },
    {
        code: "ko",
        name: "Korean",
        nativeName: "한국어",
    },
    {
        code: "es",
        name: "Spanish",
        nativeName: "Español",
    },
    {
        code: "fr",
        name: "French",
        nativeName: "Français",
    },
    {
        code: "de",
        name: "German",
        nativeName: "Deutsch",
    },
];

/**
 * Default language for the CMS
 */
export const DEFAULT_LANGUAGE = "en";

/**
 * Localization configuration object
 * This is used by cms.config.ts
 */
export const localization = {
    defaultLanguage: DEFAULT_LANGUAGE,
    languages: AVAILABLE_LANGUAGES,
} as const;

/**
 * Helper functions
 */
export const getLanguageByCode = (code: string): Language | undefined => {
    return AVAILABLE_LANGUAGES.find(lang => lang.code === code);
};

export const getLanguageName = (code: string): string => {
    const language = getLanguageByCode(code);
    return language ? language.nativeName : code;
};

/**
 * Type-safe language code type
 */
export type LanguageCode = (typeof AVAILABLE_LANGUAGES)[number]["code"];
