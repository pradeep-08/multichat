// Helpers for files attached to user messages.
// Text files are inlined into the message text (works with every provider).
// Images and PDFs are sent as native blocks, only to providers whose adapter supports them.

function textWithFiles(m) {
  let text = m.content || '';
  for (const a of m.attachments || []) {
    if (a.kind === 'text' && typeof a.text === 'string') {
      text += `\n\n--- File: ${a.name} ---\n${a.text}\n--- End of ${a.name} ---`;
    } else if ((a.kind === 'text' && typeof a.text !== 'string') || (a.kind !== 'text' && !a.data)) {
      text += `\n\n[Attachment "${a.name}" was shared earlier but is no longer available]`;
    }
  }
  return text.trim() || '(see attached file)';
}

const binaries = (m) => (m.attachments || []).filter((a) => (a.kind === 'image' || a.kind === 'pdf') && a.data);

function neededKinds(messages) {
  const kinds = new Set();
  for (const m of messages) for (const a of binaries(m)) kinds.add(a.kind);
  return [...kinds];
}

module.exports = { textWithFiles, binaries, neededKinds };
