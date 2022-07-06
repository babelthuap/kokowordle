import {buildClueRegexes, clearClueRegexesMemo, getClue} from './clue-logic.js';

/** The list of possible guesses, which will be sent from the main thread. */
let guesses = null;

/** Handle messages from the main thread. */
onmessage = ({data}) => {
  switch (data.type) {
    case 'INIT':
      guesses = data.guesses;
      postMessage('INITIALIZED');
      break;
    case 'GET_BEST_GUESS':
      getBestGuess(data.params);
      break;
    default:
      throw new Error('Unknown event type', data.type);
  }
};

/**
 * Finds the list of guesses that will minimize the size of the filtered
 * solution space.
 */
function getBestGuess({
  checkPossibleSolutions,
  possibleSolutions,
  startIndex,
  endIndex,
  bestScore,
}) {
  if (guesses == null) {
    throw new Error('`guesses` is not initialized yet');
  }

  bestScore = bestScore || Infinity;
  const guessData = [];

  // Try the possible solutions
  if (checkPossibleSolutions) {
    for (let i = startIndex; i < endIndex; i++) {
      testGuess(possibleSolutions[i]);
    }
    postMessage(guessData);
    return;
  }

  // Try the other guesses
  const alreadyTried = new Set(possibleSolutions);
  for (let i = startIndex; i < endIndex; i++) {
    const guess = guesses[i];
    if (alreadyTried.has(guess)) {
      continue;
    }
    testGuess(guess);
  }

  /**
   * Calculates the stats for a guess and adds it to `guessData` if it's equal
   * to or better than the existing guesses.
   */
  function testGuess(guess) {
    clearClueRegexesMemo();
    const stats = getSolutionSpaceStats(possibleSolutions, guess, bestScore);
    if (stats === undefined) {
      return;
    }
    if (stats.score < bestScore) {
      guessData.length = 0;
      guessData.push({guess, stats});
      bestScore = stats.score;
    } else if (stats.score === bestScore) {
      guessData.push({guess, stats});
    }
  }

  postMessage(guessData);
}

/**
 * Calculates stats over all possible solutions for the given guess. Exits early
 * if the sum (i.e. the `score`) is greater than the best known score (useful
 * for finding the best guess).
 */
function getSolutionSpaceStats(
    possibleSolutions, guess, bestKnownScore = Infinity) {
  let score = 0;
  const groups = new Map();
  for (const solution of possibleSolutions) {
    if (guess === solution) {
      continue;
    }
    const clue = getClue(solution, guess);
    const regexes = buildClueRegexes(clue);
    if (regexes.every(regex => regex.test(solution))) {
      if (groups.has(clue)) {
        groups.set(clue, groups.get(clue) + 1);
      } else {
        groups.set(clue, 1);
      }
      // The final score is the sum of the squares of each group size. This
      // is the correct way to increment it because
      // x^2 - (x-1)^2 = 2x - 1
      score += 2 * groups.get(clue) - 1;
      if (score > bestKnownScore) {
        return undefined;
      }
    }
  }
  return {score, numGroups: groups.size};
}
