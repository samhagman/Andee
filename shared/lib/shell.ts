/**
 * Shell escaping utilities for safe command execution.
 */

/**
 * Escape a string for safe use in shell commands.
 * Wraps in single quotes and escapes any embedded single quotes.
 *
 * This is the safest approach for shell escaping because single-quoted
 * strings in bash preserve everything literally except for single quotes.
 *
 * @example
 * shQuote("hello world")     // "'hello world'"
 * shQuote("it's fine")       // "'it'\\''s fine'"
 * shQuote('"; rm -rf /')     // "'\"'; rm -rf /'"
 */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
