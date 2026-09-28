// bionic —— split text into words with their leading letters marked, so the cue cards can bold
// them (the owner is neurodivergent and reads faster that way). Same counts as the desktop app.

// LEAD —— letters to bold by word length (index = length) up to 10; longer words bold ~40%.
const LEAD = [0, 1, 1, 1, 2, 3, 3, 3, 4, 4, 4];

export interface BionicPiece { lead: string; rest: string }

export function bionicPieces(text: string): BionicPiece[] {
  return text.split(/(\s+)/).map((w) => {
    const letters = /^[A-Za-z]+/.exec(w)?.[0] ?? '';
    const k = LEAD[letters.length] ?? Math.round(letters.length * 0.4);
    return { lead: w.slice(0, k), rest: w.slice(k) };
  });
}
