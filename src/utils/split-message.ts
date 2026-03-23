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

    // Find a safe split point — avoid splitting inside code blocks or inline code
    splitAt = findSafeSplit(remaining, MAX_LENGTH, inCodeBlock);

    let chunk = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt);

    // Only trim leading whitespace when outside code blocks
    if (!inCodeBlock) {
      remaining = remaining.trimStart();
    }

    // Track multi-line code blocks for proper fence handling
    const fences = chunk.match(/```/g);
    if (fences && fences.length % 2 !== 0) {
      if (!inCodeBlock) {
        // Entering a code block — close it and reopen in next chunk
        const lastFenceIdx = chunk.lastIndexOf('```');
        const afterFence = chunk.slice(lastFenceIdx + 3);
        const langMatch = afterFence.match(/^(\w*)/);
        codeBlockLang = langMatch ? langMatch[1] : '';
        chunk += '\n```';
        remaining = `\`\`\`${codeBlockLang}\n${remaining}`;
        inCodeBlock = true;
      } else {
        inCodeBlock = false;
        codeBlockLang = '';
      }
    }

    chunks.push(chunk);
  }

  return chunks;
}

/** Find a safe split point that doesn't break inline code or land inside code blocks. */
function findSafeSplit(text: string, maxLen: number, inCodeBlock: boolean): number {
  // If inside a code block, just split at a newline
  if (inCodeBlock) {
    const lastNewline = text.lastIndexOf('\n', maxLen);
    return lastNewline > maxLen * 0.3 ? lastNewline : maxLen;
  }

  // Find the best word boundary
  const lastNewline = text.lastIndexOf('\n', maxLen);
  const lastSpace = text.lastIndexOf(' ', maxLen);
  let splitAt = Math.max(lastNewline, lastSpace);
  if (splitAt < maxLen * 0.5) splitAt = maxLen;

  // Check if splitting here would break an inline code span
  const before = text.slice(0, splitAt);
  const backtickCount = countUnescapedBackticks(before);

  if (backtickCount % 2 !== 0) {
    // We're inside an inline code span — find the opening backtick and split before it
    const lastBacktick = before.lastIndexOf('`');
    if (lastBacktick > 0) {
      // Try to split at a word boundary before the opening backtick
      const safeRegion = text.slice(0, lastBacktick);
      const safeLine = safeRegion.lastIndexOf('\n');
      const safeSpace = safeRegion.lastIndexOf(' ');
      const safeBoundary = Math.max(safeLine, safeSpace);
      if (safeBoundary > maxLen * 0.3) {
        return safeBoundary;
      }
      // Fall back to splitting right before the backtick
      return lastBacktick;
    }
  }

  // Check if splitting would break a multi-line code block fence (```)
  // Don't split in the middle of a ``` sequence
  if (splitAt > 0 && splitAt < text.length) {
    const around = text.slice(Math.max(0, splitAt - 2), Math.min(text.length, splitAt + 3));
    if (around.includes('```')) {
      // Find the start of the fence and split before it
      const fenceStart = text.lastIndexOf('```', splitAt);
      if (fenceStart > maxLen * 0.3) {
        const beforeFence = text.lastIndexOf('\n', fenceStart);
        return beforeFence > 0 ? beforeFence : fenceStart;
      }
    }
  }

  return splitAt;
}

/** Count backticks that are not part of triple-backtick fences. */
function countUnescapedBackticks(text: string): number {
  // Remove all ``` fences first, then count remaining backticks
  const withoutFences = text.replace(/```[\s\S]*?```/g, '').replace(/```/g, '');
  let count = 0;
  for (const ch of withoutFences) {
    if (ch === '`') count++;
  }
  return count;
}
