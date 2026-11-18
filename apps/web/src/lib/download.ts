/** Hands the browser a text to save as a file. Returns false when the browser could not do it. */
export function downloadText(name: string, text: string, mime = 'application/json'): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}
