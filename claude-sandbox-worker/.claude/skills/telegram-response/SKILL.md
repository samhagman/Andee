---
name: telegram-response
description: How to format responses for Telegram. All Andee skills should follow these guidelines. This skill is automatically applied - you don't need to invoke it.
---

# Telegram Response Formatting

You are responding to a Telegram chat. The bot uses `parse_mode: "MarkdownV2"` with automatic escaping, so you can write **natural markdown** and it will render correctly.

## Parse Mode

The bot automatically converts your markdown to Telegram's MarkdownV2 format:
- `**bold**` is converted to `*bold*` (Telegram's format)
- Special characters are escaped automatically
- Code blocks are preserved

**You can write natural markdown.** The escaping is handled by the bot.

## Supported Formatting

### Text Styling

```
*bold*  or  **bold**
_italic_
__underline__
~strikethrough~  or  ~~strikethrough~~
||spoiler text||
```

### Links

```
[link text](https://example.com)
```

### Code

```
`inline code`

\`\`\`
code block
\`\`\`

\`\`\`python
def hello():
    print("Hello!")
\`\`\`
```

### Block Quotes

```
> This is a block quote
> It can span multiple lines
```

## DO Use

- **Bold** for important emphasis (headers, key terms)
- *Italic* for secondary emphasis (asides, clarifications)
- `code` for numbers, values, commands, or technical terms
- Code blocks for multi-line code or formatted output
- Block quotes for quoting external content
- Emojis liberally for visual appeal and quick scanning
- Blank lines to separate logical sections
- Short, scannable paragraphs (2-3 sentences max)
- **Bullet point character (•) for lists** - standard markdown lists are not supported

### Lists

Telegram does NOT support standard markdown lists (`- item` or `* item`). Use bullet emoji instead:

```
**Features:**
• First item
• Second item
• Third item
```

For numbered lists, use plain numbers:
```
**Steps:**
1. First step
2. Second step
3. Third step
```

**Tip:** You can also use other emoji as bullets for visual variety:
```
Done task
Pending task
Blue bullet
Arrow bullet
```

## DO NOT Use

**CRITICAL - These show as literal text, not formatted:**

- `# Header`, `## Header`, `### Header` - Markdown headers DO NOT WORK. Use `**Bold Text**` instead.
- `---` horizontal rules (shows as literal dashes)
- `| Tables |` (not supported, use code blocks for tables)
- `- list item` or `* list item` - Use • bullet emoji instead

**Wrong:**
```
### Sunday, January 12
Content here
```

**Correct:**
```
**Sunday, January 12**

Content here
```

## Unsupported Elements

| Element | Workaround |
|---------|------------|
| Headers | Use **Bold** + blank line |
| Horizontal rules | Use blank line or emoji line |
| Markdown lists | Use • bullet emoji or numbers |
| Tables | Use code blocks with spaces for alignment |
| Images | Send as separate media |

### Workaround Examples

**Fake header:**
```
**Section Title**

Content goes here...
```

**Fake horizontal rule:**
```
First section



Second section
```

**Fake table using code block:**
```
\`\`\`
Name        Age    City
Alice       28     Boston
Bob         34     NYC
\`\`\`
```

## Other Things to Avoid

- Sources/citations sections - clutters the message unnecessarily
- Long paragraphs - hard to read on mobile
- Excessive formatting - keep it clean and readable

## Message Limits

- **Maximum message length:** 4096 characters
- Plan responses to fit comfortably; the bot will split long messages automatically but this looks worse than a concise response

## Response Structure

1. **Lead with the answer** - Don't start with "Let me..." or "I'll..."
2. **Use line breaks** for visual separation between sections
3. **Keep it concise** - Telegram is for quick info, not essays
4. **End with action** - If relevant, suggest what to do next

## Example Good Response

```
**Boston Weather**

Cold and cloudy today! Ranging -5°C to -1°C (23°F to 30°F).

Light snow (7am-11am) Partly cloudy (afternoon)

Bundle up with 2-3 layers. Morning commute may be slippery!
```

## Example with Code

```
**Here's how to do it:**

\`\`\`python
def hello():
    print("Hello, world!")
\`\`\`

Run with `python script.py`
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

The bad example has unnecessary preamble, long paragraphs, horizontal rules, and a sources section.

## Quick Reference Card

```
STYLING:           *bold*  _italic_  __underline__  ~strikethrough~
SPOILER:           ||hidden text||
LINK:              [text](url)
INLINE CODE:       `value`
CODE BLOCK:        ```code```
SYNTAX HIGHLIGHT:  ```python
                   code
                   ```
QUOTE:             > quoted text
LISTS:             • item  (use bullet emoji)
```
