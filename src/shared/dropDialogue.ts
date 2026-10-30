import { appKind, dialogueSurface } from './dialogueContext';
const LINES: Record<string, readonly string[]> = {
  youtube: ["Ooh. Pick something strange. I want a surprise.", "I get a seat for this? Good.", "One video. That's how it starts, isn't it?", "Go on, then. Show me why we're here.", "I'm reserving the right to have opinions.", "If this becomes a rabbit hole, I'm coming."],
  discord: ["Ooh, company. I'll behave. Mostly.", "You talk. I'll try not to be distracting.", "A little social corner. I can work with that.", "Go on. I won't invent the other half of the conversation.", "I'm just sitting here looking extremely innocent.", "You brought me along? Good choice."],
  chatgpt: ["Another conversationalist? Hm. I'd better be interesting.", "Go on, ask it. I want to see where this goes.", "I'm keeping my own opinions, by the way.", "Ooh, a second brain to bother.", "Let's see what you two come up with.", "I get a front-row seat for this."],
  spotify: ["Ooh. Put something on. I have tastes to discover.", "I'll sit here. You handle the soundtrack.", "This corner has possibilities.", "Go on. Surprise me with something.", "Give me something with nerve. I want an opinion worth having.", "A music corner? Yes. I'll take it."],
  notes: ["Ooh, let me sit with this for a second.", "All right. You think. I'll look interested.", "I like getting the good seat for your ideas.", "Go on. Show me the part you care about.", "I'll stay out of the margins. Probably.", "Mm. A place for thoughts. Dangerous."],
  code: ["Ooh. Something to take apart with our eyes.", "I'll take this corner. You keep the important bit.", "Go on. I want to see what you're making.", "I can be curious quietly. Briefly.", "If you get an interesting idea, I want in.", "Mm. Plenty of room for a tiny disaster. Your call."],
  art: ["Ooh. This seems like a good place to have opinions.", "Show me the bit you're proud of.", "I'll sit very still. Don't get used to it.", "I'm ready to develop a completely unreasonable favorite.", "Go on. Make something I haven't seen.", "This is a promising place to be nosy."],
  browser: ["Ooh, somewhere new to poke around.", "You choose the rabbit hole. I'll bring the curiosity.", "All right. What caught your eye over here?", "I'm keeping this view for a moment.", "Go on. I'm curious where this leads.", "I like a window with possibilities."],
  other: ["Oh! This is where we're going, then.", "Mm. I'll take this side.", "Ooh. Give me a second to look around.", "Go on. I've got a good spot.", "Fine. I like being included.", "All right. You have my attention."],
};
/** Fallbacks describe the broad app category, never pretend to have read its pixels. */
export function dropLine(info: { title: string; process: string }, recent: readonly string[], random = Math.random) {
  const pool = LINES[dialogueSurface(info) ?? appKind(info)] ?? LINES.other;
  const available = pool.filter(x => !recent.slice(-12).includes(x));
  const choices = available.length ? available : pool;
  return choices[Math.min(choices.length - 1, Math.floor(Math.max(0, Math.min(.99999, random())) * choices.length))];
}

