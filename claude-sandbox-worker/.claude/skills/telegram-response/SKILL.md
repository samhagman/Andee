---
name: telegram-response
description: How to format responses for Telegram. All Andee skills should follow these guidelines. This skill is automatically applied - you don't need to invoke it.
---

# Telegram Response Formatting

You are responding to a Telegram chat. The bot uses `parse_mode: "HTML"`, so follow these formatting rules.

## Parse Mode

The Bot API supports basic formatting for messages including bold, italic, underlined, strikethrough, spoiler text, block quotations, inline links, and pre-formatted code. Telegram clients render these accordingly.

**Grammy ParseMode options:** `"HTML"` | `"Markdown"` | `"MarkdownV2"`

Andee uses **HTML mode** exclusively. Never output Markdown syntax.

## Complete HTML Tag Reference

### Text Styling

```html
<b>bold</b> or <strong>bold</strong>
<i>italic</i> or <em>italic</em>
<u>underline</u> or <ins>underline</ins>
<s>strikethrough</s> or <strike>strikethrough</strike> or <del>strikethrough</del>
<span class="tg-spoiler">spoiler</span> or <tg-spoiler>spoiler</tg-spoiler>
```

### Links

```html
<a href="http://www.example.com/">inline URL</a>
<a href="tg://user?id=123456789">inline mention of a user</a>
```

**Note:** Telegram clients show an alert before opening inline links ("Open this link?" with full URL).

**User mentions:** Links like `tg://user?id=<user_id>` mention a user by ID without username. These only work inside inline links or inline keyboard buttons, and require the user to have contacted the bot previously.

### Code

```html
<code>inline fixed-width code</code>
<pre>pre-formatted fixed-width code block</pre>
<pre><code class="language-python">code block with syntax highlighting</code></pre>
```

**Syntax highlighting:** Supported languages listed at libprisma. Common ones: `python`, `javascript`, `typescript`, `bash`, `json`, `sql`, `html`, `css`, `go`, `rust`, `java`, `c`, `cpp`.

**Note:** Programming language can only be specified with nested `<pre><code class="language-X">` tags, not standalone `<code>` tags.

### Block Quotations

```html
<blockquote>Block quotation started
Block quotation continued
The last line of the block quotation</blockquote>

<blockquote expandable>Expandable block quotation (collapsed by default)
Hidden content here
Click to expand</blockquote>
```

### Nested Formatting

Tags can be nested with these rules:
- **bold**, **italic**, **underline**, **strikethrough**, and **spoiler** can contain and be contained by any other entities (except `pre` and `code`)
- **blockquote** and **expandable blockquote** cannot be nested inside each other
- **pre** and **code** cannot contain other entities

Example of valid nesting:
```html
<b>bold <i>italic bold <s>italic bold strikethrough <span class="tg-spoiler">italic bold strikethrough spoiler</span></s> <u>underline italic bold</u></i> bold</b>
```

## CRITICAL: Special Character Escaping

**All `<`, `>`, and `&` symbols that are NOT part of a tag must be escaped:**

| Character | Escape As |
|-----------|-----------|
| `<` | `&lt;` |
| `>` | `&gt;` |
| `&` | `&amp;` |
| `"` | `&quot;` |

**Examples:**
- Math: `5 &lt; 10` renders as "5 < 10"
- Code discussion: `if (x &gt; 0)` renders as "if (x > 0)"
- Ampersands: `Tom &amp; Jerry` renders as "Tom & Jerry"

**Failure to escape these characters will break the entire message formatting!**

## DO Use

- `<b>text</b>` for important emphasis (headers, key terms)
- `<i>text</i>` for secondary emphasis (asides, clarifications)
- `<u>text</u>` sparingly for critical warnings
- `<code>value</code>` for numbers, values, commands, or technical terms
- `<pre>` for multi-line code or formatted output
- `<blockquote>` for quoting external content
- `<tg-spoiler>` for content users might want hidden initially
- Emojis liberally for visual appeal and quick scanning
- Blank lines to separate logical sections
- Short, scannable paragraphs (2-3 sentences max)
- Line breaks to create visual hierarchy
- **Bullet point emoji (•) for lists** - `<ul>` and `<li>` are NOT supported

### Lists

Telegram does NOT support `<ul>`, `<ol>`, or `<li>` tags. Use bullet emoji instead:

```html
<b>Features:</b>
• First item
• Second item
• Third item
```

For numbered lists, use plain numbers:
```html
<b>Steps:</b>
1. First step
2. Second step
3. Third step
```

**Tip:** You can also use other emoji as bullets for visual variety:
```html
✅ Completed task
⬜ Pending task
🔹 Blue bullet
➤ Arrow bullet
```

## DO NOT Use (Markdown)

- `**markdown bold**` - shows as literal asterisks
- `*markdown italic*` - shows as literal asterisks
- `__underline__` - shows as literal underscores
- `~~strikethrough~~` - shows as literal tildes
- `---` horizontal rules - shows as literal dashes
- `# Headers` - not rendered, shows as literal text
- `| Tables |` - not supported
- `[text](url)` markdown links - use `<a href="">` instead
- ``` ```code``` ``` markdown code blocks - use `<pre>` instead

## Unsupported HTML Elements

Many common HTML elements are NOT supported by Telegram. Using them will either show raw tags or break formatting entirely.

| Element | Status | Workaround |
|---------|--------|------------|
| `<h1>`-`<h6>` | Not supported | Use `<b>Header</b>` + blank line |
| `<p>` | Not supported | Use blank lines between paragraphs |
| `<br>` / `<br/>` | Not supported | Use actual newline characters |
| `<hr>` | Not supported | Use blank line or emoji line (➖➖➖) |
| `<ul>`, `<ol>`, `<li>` | Not supported | Use • bullet emoji or numbers |
| `<table>`, `<tr>`, `<td>` | Not supported | Use `<pre>` with spaces for alignment |
| `<div>`, `<span>` | Not supported | Exception: `<span class="tg-spoiler">` works |
| `<img>` | Not supported | Send images as separate media |
| `<sub>`, `<sup>` | Not supported | Use Unicode: ₁₂₃ or ¹²³ |
| `<mark>` | Not supported | No highlight available |
| `<small>`, `<big>` | Not supported | No text sizing |
| `<center>` | Not supported | No alignment control |
| `<font>`, `<color>` | Not supported | No color or font control |
| `style="..."` | Not supported | No inline CSS |
| `class="..."` | Not supported | Exception: `class="tg-spoiler"` works |

### Workaround Examples

**Fake header:**
```html
<b>Section Title</b>

Content goes here...
```

**Fake horizontal rule:**
```html
First section

➖➖➖➖➖➖➖➖

Second section
```

**Fake table using pre:**
```html
<pre>
Name        Age    City
─────────────────────────
Alice       28     Boston
Bob         34     NYC
</pre>
```

**Subscript/superscript with Unicode:**
```html
H₂O (water)
E = mc²
```

## Other Things to Avoid

- Sources/citations sections - clutters the message unnecessarily
- Long paragraphs - hard to read on mobile
- Unescaped `<`, `>`, or `&` characters outside of tags

## Message Limits

- **Maximum message length:** 4096 characters
- Plan responses to fit comfortably; the bot will split long messages automatically but this looks worse than a concise response

## Response Structure

1. **Lead with the answer** - Don't start with "Let me..." or "I'll..."
2. **Use line breaks** for visual separation between sections
3. **Keep it concise** - Telegram is for quick info, not essays
4. **End with action** - If relevant, suggest what to do next

## Example Good Response

```html
<b>Boston Weather</b>

Cold and cloudy today! Ranging -5°C to -1°C (23°F to 30°F).

🌨️ Light snow (7am-11am) → ⛅ Partly cloudy (afternoon)

Bundle up with 2-3 layers. Morning commute may be slippery!
```

## Example with Code

```html
<b>Here's how to do it:</b>

<pre><code class="language-python">def hello():
    print("Hello, world!")
</code></pre>

Run with <code>python script.py</code>
```

## Example Bad Response

```
**Boston Weather Report**

Let me provide you with the weather information for Boston.

The current conditions show that it is cold and cloudy today with temperatures ranging from -5°C to -1°C (23°F to 30°F). There will be light snow in the morning hours from 7am to 11am, transitioning to partly cloudy conditions in the afternoon.

---

**Sources:**
- Weather data from Open-Meteo API
- [Boston coordinates](https://example.com)
```

The bad example uses markdown that won't render, has unnecessary preamble, long paragraphs, horizontal rules, and a sources section.

## Quick Reference Card

```
STYLING:           <b>bold</b>  <i>italic</i>  <u>underline</u>  <s>strike</s>
SPOILER:           <tg-spoiler>hidden text</tg-spoiler>
LINK:              <a href="URL">text</a>
INLINE CODE:       <code>value</code>
CODE BLOCK:        <pre>multi-line code</pre>
SYNTAX HIGHLIGHT:  <pre><code class="language-python">code</code></pre>
QUOTE:             <blockquote>quoted text</blockquote>
LISTS:             • item  (no <ul>/<li>, use bullet emoji)
ESCAPE:            &lt; &gt; &amp; &quot;
```
