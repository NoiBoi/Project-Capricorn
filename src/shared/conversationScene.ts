export interface SceneEntry { id: string; role: 'user' | 'assistant'; text: string; at: number; event?: string; contextSources?:string[] }
export interface SceneReading {
  topic: string; position: string; intention: string; openQuestion: string; tone: 'ordinary' | 'playful' | 'quiet' | 'serious';
  evidence: string; sourceId: string;
}
export interface ConversationSceneState { version: 1; entries: SceneEntry[]; reading?: SceneReading; revision: number }
export interface DialoguePatterns { lines: number; interjections: number; questions: number; reversals: number; selfPerformance: number }
export function dialoguePatterns(lines: readonly string[]): DialoguePatterns {
  return { lines: lines.length,
    interjections: lines.filter(t => /^(?:oh|ooh|mm|hmm|ha|well|hey|okay|right|fine)\b/i.test(t.trim())).length,
    questions: lines.filter(t => /\?\s*["”']?$/.test(t.trim())).length,
    reversals: lines.filter(t => /\b(?:but|actually|fine|mostly|obviously|apparently|probably|suspiciously)\b/i.test(t)).length,
    selfPerformance: lines.filter(t => /\b(?:I (?:approve|supervise)|no (?:pep talk|flourish)|(?:being|looking) (?:innocent|interesting)|(?:tiny|little) (?:disaster|trouble|chaos)|your (?:chauffeur|supervisor))\b/i.test(t)).length };
}
