/**
 * `@comecaramelos/dsh-ancesters/locales` — types.
 */
export declare const LOCALE_NAMESPACE: string;
export declare const DICTIONARIES: Record<string, Record<string, string>>;
export declare function mergeDictionaries(
    base?: Record<string, Record<string, string>>,
    override?: Record<string, Record<string, string>>
): Record<string, Record<string, string>>;
