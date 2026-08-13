// Simple heuristic bot AI (party-game difficulty, per spec §6)

function pickCandidateSuspect(suspects, knownValuesById) {
  // knownValuesById: { suspectId: value } for suspects this bot has actually checked
  const known = suspects
    .filter((s) => knownValuesById[s.id] !== undefined && knownValuesById[s.id] !== null)
    .map((s) => ({ id: s.id, value: knownValuesById[s.id] }));
  const hasNullKnown = suspects.some((s) => knownValuesById[s.id] === null);

  if (known.length === 0) return null;

  const hasFive = known.some((k) => k.value === 5);
  known.sort((a, b) => (hasFive ? a.value - b.value : b.value - a.value));
  return known[0].id;
}

// Finder's free choice of 2 of 3 suspects to check
function botFinderCheckChoice(suspectIds) {
  const shuffled = suspectIds.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 2);
}

// Decide which suspect to place the accusation chip on
function botAccusationChoice({ suspects, knowledge, lastAccusedSuspectId, isFirstFinderTurn }) {
  const candidate = pickCandidateSuspect(suspects, knowledge.seenSuspects || {});
  const confident = candidate !== null && Math.random() < 0.75;
  if (confident) return candidate;

  if (!isFirstFinderTurn && lastAccusedSuspectId && Math.random() < 0.5) {
    return lastAccusedSuspectId; // follow the previous accuser
  }
  // bluff: pick any suspect, weighted toward the unseen one if known
  const unseen = suspects.find((s) => s.unseenMarker);
  if (unseen && Math.random() < 0.6) return unseen.id;
  const pool = suspects.map((s) => s.id);
  return pool[Math.floor(Math.random() * pool.length)];
}

module.exports = { botFinderCheckChoice, botAccusationChoice };
