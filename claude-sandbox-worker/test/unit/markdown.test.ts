import { describe, it, expect } from "vitest";
import { escapeMarkdownV2 } from "../../../shared/telegram/markdown";

describe("Telegram MarkdownV2 Escaping", () => {
  describe("escapeMarkdownV2", () => {
    describe("basic text escaping", () => {
      it("escapes periods", () => {
        const result = escapeMarkdownV2("Hello. World.");
        expect(result).toBe("Hello\\. World\\.");
      });

      it("escapes exclamation marks", () => {
        const result = escapeMarkdownV2("Hello! World!");
        expect(result).toBe("Hello\\! World\\!");
      });

      it("escapes parentheses", () => {
        const result = escapeMarkdownV2("Hello (world)");
        expect(result).toBe("Hello \\(world\\)");
      });

      it("escapes square brackets", () => {
        const result = escapeMarkdownV2("Hello [world]");
        expect(result).toBe("Hello \\[world\\]");
      });

      it("escapes hash symbols", () => {
        const result = escapeMarkdownV2("Hello #world");
        expect(result).toBe("Hello \\#world");
      });

      it("escapes plus signs", () => {
        const result = escapeMarkdownV2("Hello + world");
        expect(result).toBe("Hello \\+ world");
      });

      it("escapes equals signs", () => {
        const result = escapeMarkdownV2("a = b");
        expect(result).toBe("a \\= b");
      });

      it("escapes pipes", () => {
        const result = escapeMarkdownV2("a | b");
        expect(result).toBe("a \\| b");
      });

      it("escapes curly braces", () => {
        const result = escapeMarkdownV2("Hello {world}");
        expect(result).toBe("Hello \\{world\\}");
      });

      it("escapes greater than", () => {
        const result = escapeMarkdownV2("a > b");
        expect(result).toBe("a \\> b");
      });
    });

    describe("markdown formatting preservation", () => {
      it("preserves code blocks", () => {
        const input = "Here is code:\n```javascript\nconst x = 1;\n```\nEnd.";
        const result = escapeMarkdownV2(input);
        expect(result).toContain("```javascript\nconst x = 1;\n```");
        expect(result).toContain("End\\.");
      });

      it("preserves inline code", () => {
        const input = "Use `console.log()` to debug.";
        const result = escapeMarkdownV2(input);
        expect(result).toContain("`console.log()`");
        expect(result).toContain("debug\\.");
      });

      it("converts double asterisks to single for bold", () => {
        const input = "This is **bold** text.";
        const result = escapeMarkdownV2(input);
        expect(result).toContain("*bold*");
        expect(result).not.toContain("**bold**");
      });

      it("converts double tildes to single for strikethrough", () => {
        const input = "This is ~~strikethrough~~ text.";
        const result = escapeMarkdownV2(input);
        expect(result).toContain("~strikethrough~");
        expect(result).not.toContain("~~strikethrough~~");
      });

      it("preserves italic formatting", () => {
        const input = "This is _italic_ text.";
        const result = escapeMarkdownV2(input);
        expect(result).toContain("_italic_");
      });
    });

    describe("markdown links", () => {
      it("preserves and escapes links", () => {
        const input = "Check [Google](https://google.com).";
        const result = escapeMarkdownV2(input);
        // Link should be preserved
        expect(result).toMatch(/\[.*\]\(https:\/\/google\.com\)/);
      });

      it("escapes special chars in link text", () => {
        const input = "[Hello! World.](https://example.com)";
        const result = escapeMarkdownV2(input);
        // Link text should have escaped chars
        expect(result).toContain("\\!");
        expect(result).toContain("\\.");
      });

      it("handles URLs with parentheses", () => {
        const input = "[Wiki](https://en.wikipedia.org/wiki/Test_(page))";
        const result = escapeMarkdownV2(input);
        // Parentheses in URL should be escaped
        expect(result).toContain("\\)");
      });
    });

    describe("complex cases", () => {
      it("handles mixed content", () => {
        const input = "Hello **bold** and _italic_ with `code` and [link](http://x.com).";
        const result = escapeMarkdownV2(input);
        expect(result).toContain("*bold*");
        expect(result).toContain("_italic_");
        expect(result).toContain("`code`");
        // Should escape period at end
        expect(result).toMatch(/\\\.$/);
      });

      it("handles multiple code blocks", () => {
        const input = "```js\na\n```\nMiddle.\n```py\nb\n```";
        const result = escapeMarkdownV2(input);
        expect(result).toContain("```js\na\n```");
        expect(result).toContain("```py\nb\n```");
        expect(result).toContain("Middle\\.");
      });

      it("returns empty string for empty input", () => {
        expect(escapeMarkdownV2("")).toBe("");
      });

      it("handles text with only special characters", () => {
        const result = escapeMarkdownV2(".!#");
        expect(result).toBe("\\.\\!\\#");
      });
    });
  });
});
