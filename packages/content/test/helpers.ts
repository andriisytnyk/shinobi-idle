/** Shared test helpers. */

/** Problems of one description; an empty list means it is fine. */
export function descProblems(text: string | undefined): string[] {
  if (text === undefined || text.trim() === '') return ['empty'];
  const problems: string[] = [];
  if (text.trim().length < 20) problems.push('shorter than 20 characters');
  if (/todo|tbd|lorem|fixme|xxx/i.test(text)) problems.push('placeholder');
  if (/[0-9]/.test(text)) problems.push('contains a number');
  if (/[A-Za-z]{3,}/.test(text)) problems.push('contains Latin words');
  if (!/[а-яіїєґ]/i.test(text)) problems.push('no Ukrainian letters');
  const sentences = text.split(/[.!?…]+(?=\s|$)/).filter((s) => s.trim() !== '');
  if (sentences.length > 2) problems.push(`${sentences.length} sentences`);
  return problems;
}
