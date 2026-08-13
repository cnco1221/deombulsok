const BASE_VALUES = [2, 3, 4, 5, 6, 7, 8];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Returns a shuffled array of card values (number = suspect number, null = 무지(X) card)
// Pool size: 2p/3p -> 7 (no X), 4p -> 8 (1 X), 5p -> 9 (2 X)
function buildDeck(playerCount) {
  let values;
  if (playerCount === 2 || playerCount === 3) {
    values = [...BASE_VALUES];
  } else if (playerCount === 4) {
    values = [...BASE_VALUES, null];
  } else if (playerCount === 5) {
    values = [...BASE_VALUES, null, null];
  } else {
    throw new Error('invalid player count: ' + playerCount);
  }
  return shuffle(values);
}

// 범인 판별: 숫자가 가장 큰 카드. 단, 용의자 중 5가 있으면 가장 작은 숫자가 범인. 무지(X)는 절대 범인이 될 수 없음.
function determineCulpritIndex(suspectValues) {
  const hasFive = suspectValues.some((v) => v === 5);
  const numericIdxs = suspectValues
    .map((v, i) => ({ v, i }))
    .filter((x) => x.v !== null);
  if (numericIdxs.length === 0) return -1;
  if (hasFive) {
    numericIdxs.sort((a, b) => a.v - b.v);
  } else {
    numericIdxs.sort((a, b) => b.v - a.v);
  }
  return numericIdxs[0].i;
}

module.exports = { BASE_VALUES, shuffle, buildDeck, determineCulpritIndex };
