import type { RoomArea, Task } from '../types/index.ts';

const OFFICIAL_WCR_ADDRESS =
  '6th Floor, Tower A, M3M Urbana Business Park, Golf Course Extension Road, Sector 67, Gurugram, Haryana 122101, India';

/**
 * Collapses accidental repeated words, repeated multi-word phrases, and legacy room/name
 * corruptions (e.g., "The The The The Skyline" -> "The Skyline", "Prestige Loft Loft" -> "Prestige Loft")
 * while preserving valid original text, punctuation, casing, and multiline structure.
 */
export function deduplicateRepeatedPhrases(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';

  // Normalize per line so intentional newlines in descriptions/notes are preserved
  const normalizedLines = raw.split(/\r?\n/).map((line) => {
    let text = line.replace(/[ \t]{2,}/g, ' ').trim();
    if (!text) return '';

    // 1. Canonicalize known WCR room name expansions idempotently
    text = text
      .replace(/\b(?:the[ \t]+)+skyline\b/gi, 'The Skyline')
      .replace(/\b(?:the[ \t]+)+summit\b/gi, 'The Summit')
      .replace(/\b(?:the[ \t]+){2,}community\b/gi, 'Community')
      .replace(/\bprestige(?:[ \t]+loft){2,}\b/gi, 'Prestige Loft')
      .replace(/\bprime(?:[ \t]+loft){2,}\b/gi, 'Prime Loft')
      .replace(/(?:elegance[ \t]+suite[ \t]*\()+[ \t]*elegance[ \t]+suite[ \t]*\(kimmi[ \t]+(?:mam[ \t]+(?:room|suite)|suite)\)\)+/gi, 'Elegance Suite (Kimmi Mam Room)')
      .replace(/\belegance[ \t]+suite(?:[ \t]*\(kimmi[ \t]+(?:mam[ \t]+(?:room|suite)|suite)\)){1,}/gi, 'Elegance Suite (Kimmi Mam Room)')
      .replace(/\belegance[ \t]+suite[ \t]*\((?:kimmi[ \t]+(?:mam[ \t]+(?:room|suite)|suite)|kimmi)\)/gi, 'Elegance Suite (Kimmi Mam Room)');

    // 2. Collapse duplicate adjacent bracketed or parenthetical tags: "[URGENT] [URGENT]" or "(X) (X)"
    for (let i = 0; i < 4; i++) {
      const prev = text;
      text = text
        .replace(/(\[[^\[\]\n]{2,40}\])(?:[ \t]+\1)+/gi, '$1')
        .replace(/(\([^()\n]{2,60}\))(?:[ \t]+\1)+/gi, '$1');
      if (text === prev) break;
    }

    // 3. Heal duplicated "Prepare <Room> – [URGENT] Prepare <Room>..." prefix from natural-language parser
    text = text.replace(
      /^(Prepare[ \t]+[^–\-\n]+?)[ \t]*[–-][ \t]*(\[URGENT\][ \t]*)?\1\b/i,
      (_match, phrase: string, urgentTag?: string) => `${urgentTag || ''}${phrase}`
    );

    // 4. Collapse consecutive duplicate 2-to-5 word phrases (across spaces or en-dash/hyphen)
    for (let i = 0; i < 5; i++) {
      const prev = text;
      text = text.replace(
        /\b([A-Za-z0-9'][A-Za-z0-9'’]*(?:[ \t]+[A-Za-z0-9'][A-Za-z0-9'’]*){1,4})(?:[ \t]+|[ \t]*[–-][ \t]*)\1\b/gi,
        '$1'
      );
      if (text === prev) break;
    }

    // 5. Collapse consecutive duplicate single words (e.g. "The The", "Clean clean", "Water Water")
    for (let i = 0; i < 8; i++) {
      const prev = text;
      text = text.replace(
        /\b([A-Za-z][A-Za-z0-9']*)[ \t]+([A-Za-z][A-Za-z0-9']*)\b/g,
        (full, w1: string, w2: string) => {
          if (w1.toLowerCase() !== w2.toLowerCase()) return full;
          // Prefer capitalized form when deduplicating mixed-case pairs like "the The" -> "The"
          const w1Upper = w1[0] === w1[0].toUpperCase() && w1[0] !== w1[0].toLowerCase();
          const w2Upper = w2[0] === w2[0].toUpperCase() && w2[0] !== w2[0].toLowerCase();
          if (!w1Upper && w2Upper) return w2;
          return w1;
        }
      );
      if (text === prev) break;
    }

    return text.replace(/[ \t]{2,}/g, ' ').trim();
  });

  return normalizedLines.join('\n').trim();
}

/**
 * Full WCR string normalizer combining legacy name/address cleanup with phrase deduplication.
 * Safe and idempotent: normalizeDisplayText(normalizeDisplayText(x)) === normalizeDisplayText(x).
 */
export function normalizeDisplayText(val?: string): string {
  if (!val || typeof val !== 'string') return val || '';

  const legacyCleaned = val
    .replace(/kimmy\.mam@whitecollarrealty\.com/gi, 'kimmi.mam@whitecollarrealty.com')
    .replace(/Kimmy/g, 'Kimmi')
    .replace(/kimmy/g, 'kimmi')
    .replace(/(?:Lalit Sir's|Executive Cabins?) and Kimmi's Cabins?/gi, 'Lalit Sir Room and Elegance Suite (Kimmi Mam Room)')
    .replace(/\bLalit Sir's Cabin\b/gi, 'Lalit Sir Room')
    .replace(/\bExecutive Cabin\b/gi, 'Lalit Sir Room')
    .replace(/\bKimmi's Cabin\b/gi, 'Elegance Suite (Kimmi Mam Room)')
    .replace(/(?<!Elegance Suite\s*\()\bKimmi Mam Room\b/gi, 'Elegance Suite (Kimmi Mam Room)')
    .replace(/\bBCR Air\b/gi, 'WCR Air')
    .replace(/\bPrime Block\b/gi, 'Prime Loft')
    .replace(/\b(?:Residency|Redeincy)\b/gi, 'Regency')
    .replace(/\bAllegation Suite\b/gi, 'Elegance Suite (Kimmi Mam Room)')
    .replace(/\bElegance Suite[ \t]*\(Kimmi(?:[ \t]+Mam)?[ \t]+(?:Room|Suite)\)/gi, 'Elegance Suite (Kimmi Mam Room)')
    .replace(/\bElegance Suite[ \t]*\(Kimmi Suite\)/gi, 'Elegance Suite (Kimmi Mam Room)')
    .replace(/\bPrestige Block(?:[ \t]*[–-][ \t]*Waiting Room)?\b/gi, 'Prestige Loft')
    .replace(/\s*before 8:00 PM shift end/gi, '')
    .replace(/Automatic Shift-End Scheduler/gi, 'Automatic Closing Scheduler')
    .replace(/Daily Shift Active\s*·\s*9:00 AM\s*[–-]\s*8:00 PM(\s*IST)?/gi, 'Daily Operations Active')
    .replace(/Daily Tasks Generated\s*·\s*9:00 AM\s*[–-]\s*8:00 PM(\s*IST)?/gi, 'Daily Tasks Generated (IST)')
    .replace(/8:00 PM Shift Closing Audit/gi, 'End-of-Day Closing Audit')
    .replace(/Shift closed at 8:00 PM\.\s*/gi, '')
    .replace(/\s*Shift completes at 8:00 PM\.?/gi, '')
    .replace(/daily shift automation \(Asia\/Kolkata 9:00 AM\s*[–-]\s*8:00 PM\)/gi, 'automated IST task scheduling')
    .replace(/\s*\(9:00 AM\s*[–-]\s*8:00 PM[^)]*\)/gi, '')
    .replace(/\s*·\s*9:00 AM\s*[–-]\s*8:00 PM(\s*IST)?/gi, '')
    .replace(/\s*Geofence verification:.*$/i, '')
    .replace(/\bWashrooms?\b/gi, 'Dustbin Task')
    .replace(/Iris Broadway,?\s*Gurugram/gi, OFFICIAL_WCR_ADDRESS);

  return deduplicateRepeatedPhrases(legacyCleaned);
}

/**
 * Canonicalizes standalone room names (e.g., exact "Skyline" -> "The Skyline") plus full display normalization.
 */
export function normalizeRoomName(name?: string): string {
  const cleaned = normalizeDisplayText(name);
  if (/^washrooms?(?:[ \t]+tasks?)?$/i.test(cleaned)) return 'Dustbin Task';
  if (/^skyline$/i.test(cleaned)) return 'The Skyline';
  if (/^summit$/i.test(cleaned)) return 'The Summit';
  if (/^(?:the[ \t]+)?community$/i.test(cleaned)) return 'Community';
  if (/^(?:executive[ \t]+cabin|lalit[ \t]+sir'?s?[ \t]+(?:cabin|room))$/i.test(cleaned)) return 'Lalit Sir Room';
  if (/^(?:kimmi'?s?[ \t]+cabin|kimmi[ \t]+mam'?s?[ \t]+(?:cabin|room|suite))$/i.test(cleaned)) return 'Elegance Suite (Kimmi Mam Room)';
  if (/^(?:allegation|allegation[ \t]+suite|elegance(?:[ \t]+suite)?(?:[ \t]*\((?:kimmi[ \t]+(?:mam[ \t]+(?:room|suite)|suite)|kimmi)\))?)$/i.test(cleaned)) return 'Elegance Suite (Kimmi Mam Room)';
  return cleaned;
}

export function normalizeTaskRecord<T extends Task>(task: T): T {
  if (!task || typeof task !== 'object') return task;
  return {
    ...task,
    title: normalizeDisplayText(task.title),
    description: task.description !== undefined ? normalizeDisplayText(task.description) : task.description,
    roomAreaName: normalizeRoomName(task.roomAreaName),
    assignedToName: normalizeDisplayText(task.assignedToName),
    createdByName: normalizeDisplayText(task.createdByName),
    dueTime: normalizeDisplayText(task.dueTime),
    blockedReason: task.blockedReason !== undefined ? normalizeDisplayText(task.blockedReason) : task.blockedReason,
    rejectionReason:
      task.rejectionReason !== undefined ? normalizeDisplayText(task.rejectionReason) : task.rejectionReason,
    checklist: Array.isArray(task.checklist)
      ? task.checklist.map((item) => ({
          ...item,
          text: normalizeDisplayText(item.text),
          note: item.note !== undefined ? normalizeDisplayText(item.note) : item.note,
        }))
      : [],
    photoEvidence: task.photoEvidence
      ? {
          ...task.photoEvidence,
          roomName: normalizeRoomName(task.photoEvidence.roomName),
        }
      : task.photoEvidence,
  };
}

export function normalizeRoomRecord<T extends RoomArea>(room: T): T {
  if (!room || typeof room !== 'object') return room;
  return {
    ...room,
    name: normalizeRoomName(room.name),
    notes: room.notes !== undefined ? normalizeDisplayText(room.notes) : room.notes,
    defaultChecklist: Array.isArray(room.defaultChecklist)
      ? room.defaultChecklist.map((text) => normalizeDisplayText(text))
      : [],
    currentAssignment: room.currentAssignment
      ? {
          ...room.currentAssignment,
          roomAreaName: normalizeRoomName(room.currentAssignment.roomAreaName),
          visitorName: normalizeDisplayText(room.currentAssignment.visitorName),
          reference: normalizeDisplayText(room.currentAssignment.reference),
          instructions:
            room.currentAssignment.instructions !== undefined
              ? normalizeDisplayText(room.currentAssignment.instructions)
              : room.currentAssignment.instructions,
        }
      : room.currentAssignment,
  };
}
