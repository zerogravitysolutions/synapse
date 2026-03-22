const MAX_LENGTH = 1900;

export function splitMessage(text: string): string[] {
  if (text.length <= MAX_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  let inCodeBlock = false;
  let codeBlockLang = '';

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitAt = MAX_LENGTH;

    // Find the last word boundary before the limit
    const lastNewline = remaining.lastIndexOf('\n', MAX_LENGTH);
    const lastSpace = remaining.lastIndexOf(' ', MAX_LENGTH);
    const boundary = Math.max(lastNewline, lastSpace);

    if (boundary > MAX_LENGTH * 0.5) {
      splitAt = boundary;
    }

    let chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);

    // Only trim leading whitespace when outside code blocks
    // to preserve indentation inside code
    if (!inCodeBlock) {
      remaining = remaining.trimStart();
    }

    // Track code blocks for proper fence handling
    const fences = chunk.match(/```/g);
    if (fences && fences.length % 2 !== 0) {
      // Odd number of fences means we're splitting inside a code block
      if (!inCodeBlock) {
        // Entering a code block — find the language tag
        const lastFenceIdx = chunk.lastIndexOf('```');
        const afterFence = chunk.slice(lastFenceIdx + 3);
        const langMatch = afterFence.match(/^(\w*)/);
        codeBlockLang = langMatch ? langMatch[1] : '';
        chunk += '\n```';
        remaining = `\`\`\`${codeBlockLang}\n${remaining}`;
        inCodeBlock = true;
      } else {
        // Exiting the code block
        inCodeBlock = false;
        codeBlockLang = '';
      }
    }

    chunks.push(chunk);
  }

  return chunks;
}
