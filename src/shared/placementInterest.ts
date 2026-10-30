export function placementInterest(input: { title: string; visits: number; returning: boolean; awaySeconds: number; inverted: boolean }, random = Math.random) {
  const title = input.title.replace(/\s[-–]\s(?:Google Chrome|Microsoft Edge|Mozilla Firefox|Notepad)$/i, '').trim();
  const meaningful = title.length > 5 && !/^(?:desktop|program manager|untitled(?:.*)?|new tab|settings|home|file explorer|google chrome|microsoft edge|notepad)$/i.test(title);
  const interesting = input.inverted || (meaningful && input.visits <= 1) || (meaningful && input.returning && input.awaySeconds >= 180);
  return { interesting, react: interesting || random() < .05, reason: input.inverted ? 'an unusual upside-down perch' : input.returning ? 'returning to a familiar view after an absence' : meaningful ? 'a new, meaningful window title' : 'an ordinary repositioning' };
}
