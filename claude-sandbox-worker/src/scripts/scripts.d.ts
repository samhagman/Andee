/**
 * TypeScript declaration for .script.js files imported as raw text.
 * Wrangler's [[rules]] with type = "Text" imports these as strings.
 */
declare module '*.script.js' {
  const content: string;
  export default content;
}
