import {log, logGuess, resetBubble, scrollToBottom} from './logger.js';
import {buildClueRegexes, getClue} from './solver.js';
import {distributeRange, El, HARDWARE_CONCURRENCY, isMobile, rand, shuffle} from './util.js';

// If on mobile, restrict guesses to the possible solutions
if (isMobile()) {
  console.log(
      'MOBILE MODE:',
      'Only guess valid solutions. This is faster, but may not be optimal.');
  fetch('solutions.json').then(response => response.json()).then(solutions => {
    shuffle(solutions);
    init({solutions, guesses: solutions});
  });
} else {
  Promise
      .all([
        fetch('solutions.json').then(response => response.json()),
        fetch('guesses.json').then(response => response.json()),
      ])
      .then(([solutions, guesses]) => {
        guesses.push(...solutions);
        shuffle(solutions);
        shuffle(guesses);
        init({solutions, guesses});
      });
}

// Prep for parallel processing
const workers = new Array(HARDWARE_CONCURRENCY);
for (let id = 0; id < HARDWARE_CONCURRENCY; id++) {
  workers[id] = new Worker('worker.js', {name: id, type: 'module'});
}

/** Initializes the main logic. */
function init({solutions, guesses}) {
  El.solutionInput.addEventListener('keydown', (e) => {
    setTimeout(() => {
      if (!/^[A-Za-z]{0,5}$/.test(El.solutionInput.value)) {
        El.solutionInput.value =
            El.solutionInput.value.replace(/[^A-Za-z]/g, '').slice(0, 5);
      }
      if (e.key === 'Enter') {
        solve({solutions, guesses});
      }
    }, 0);
  });
  El.solutionInput.focus();

  El.randSolution.addEventListener('click', () => {
    El.solutionInput.value = solutions[rand(solutions.length)];
  });
  El.randSolution.click();

  El.autoSolve.addEventListener('click', () => solve({solutions, guesses}));

  for (const worker of workers) {
    worker.postMessage({type: 'INIT', guesses});
  }

  Promise
      .all(workers.map((worker, i) => {
        return new Promise(res => {
          worker.onmessage = ({data}) => {
            console.log(`worker #${i}`, data);
            res();
          };
        });
      }))
      .then(() => {
        El.loadingSpinner.classList.add('hidden');
        console.log('main thread initialized', performance.now());
      });
}

let inProgress = false;

/**
 * Handles "Solve" button clicks: validates `solution` and then starts to
 * autoplay.
 */
async function solve({solutions, guesses}) {
  if (inProgress) {
    return;
  }

  if (El.solutionInput.value.length === 0) {
    El.botOutput.classList.add('error');
    El.botOutput.innerText =
        'Please enter a solution for the KokoWordle Solver to try to guess.';
    return;
  }
  const solution = El.solutionInput.value.toUpperCase();
  if (!solutions.includes(solution)) {
    El.botOutput.classList.add('error');
    El.botOutput.innerText = `"${solution}" is not a valid solution.`;
    return;
  }
  El.botOutput.classList = '';
  El.botOutput.innerHTML = '';
  resetBubble();

  inProgress = true;
  El.loadingSpinner.classList.remove('hidden');
  await autoplay(solution, {solutions, guesses});
  inProgress = false;
  El.loadingSpinner.classList.add('hidden');
}

/** Plays a full game of Wordle trying to guess `solution`. */
async function autoplay(solution, {solutions, guesses}) {
  const start = performance.now();

  let guess = await nextStep({solutions, guesses});
  let clues = [getClue(solution, guess)];
  await logGuess(guess, clues[0]);
  let tries = 1;
  while (guess !== solution) {
    log('');
    guess = await nextStep({solutions, guesses}, ...clues);
    clues.push(getClue(solution, guess));
    await logGuess(guess, clues[clues.length - 1]);
    tries++;
  }

  await log(
      `done in %c${tries}%c ${tries > 1 ? 'guesses' : 'guess'}, ${
          Math.round(performance.now() - start)}ms`,
      'color:#9575cd', 'color:unset');
  await scrollToBottom();
  return tries;
}

/** Makes a guess in one step of a Wordle game. */
async function nextStep({solutions, guesses}, ...clues) {
  if (clues.length === 0) {
    const guess = getFirstGuess();
    await log('Here\'s a good first guess:', guess);
    return guess;
  }
  clues = clues.map(clue => clue.toUpperCase());
  const possibleSolutions = getPossibleSolutions({solutions}, ...clues);
  await log(
      `Possible solutions (${possibleSolutions.length}):`,
      possibleSolutions.slice(0).sort().join(', '));
  if (possibleSolutions.length <= 2) {
    const bestGuess = possibleSolutions[rand(possibleSolutions.length)];
    await log('Best next guess:', bestGuess);
    return bestGuess;
  }

  await log('Calculating...');
  await scrollToBottom();
  const topGuesses = await getBestGuess({possibleSolutions, guesses});

  await log('Best next guesses:');
  shuffle(topGuesses);
  preferValidSolutions({topGuesses, solutions});
  topGuesses.sort((a, b) => b.stats.numGroups - a.stats.numGroups);
  for (let {guess, stats} of topGuesses.slice(0, 5)) {
    const solnsFmt = Math.round(stats.avgSolutions * 100) / 100;
    await log(
        `${guess} - %c${solnsFmt}%c avg solutions left, %c${
            stats.numGroups}%c groups`,
        'color:#9575cd', 'color:unset', 'color:#9575cd', 'color:unset');
  }
  if (topGuesses.length > 5) {
    await log('...');
  }
  return topGuesses[0].guess;
}

/** Sort `topGuesses` so that valid solutions come first. */
function preferValidSolutions({topGuesses, solutions}) {
  for (let i = 0, valid = 0; i < topGuesses.length; i++) {
    if (solutions.includes(topGuesses[i].guess)) {
      let temp = topGuesses[valid];
      topGuesses[valid] = topGuesses[i];
      topGuesses[i] = temp;
      valid++;
    }
  }
}

/**
 * Finds the list of guesses that will minimize the size of the filtered
 * solution space.
 */
async function getBestGuess({possibleSolutions, guesses}) {
  const start = performance.now();

  let bestScore = Infinity;
  let guessData = [];

  const ranges = distributeRange(0, possibleSolutions.length);
  const tasks = ranges.map(([startIndex, endIndex], workerIndex) => {
    return new Promise(async (resolve) => {
      workers[workerIndex].postMessage({
        type: 'GET_BEST_GUESS',
        params: {
          checkPossibleSolutions: true,
          possibleSolutions: possibleSolutions,
          startIndex,
          endIndex,
        },
      });
      const workerGuessData = await new Promise(resolve => {
        workers[workerIndex].onmessage = (e) => {
          resolve(e.data);
        };
      });
      if (workerGuessData.length > 0) {
        const workerBestScore = workerGuessData[0].stats.score;
        if (workerBestScore < bestScore) {
          guessData = workerGuessData;
          bestScore = workerBestScore;
        } else if (workerBestScore === bestScore) {
          guessData.push(...workerGuessData);
        }
      }
      resolve();
    });
  });
  await Promise.all(tasks);

  // If bestScore is <= the number of possibleSolutions, then we've already
  // found the best guess. No need to check the other guesses.
  if (bestScore > possibleSolutions.length) {
    const ranges_ = distributeRange(0, guesses.length);
    const tasks_ = ranges_.map(([startIndex, endIndex], workerIndex) => {
      return new Promise(async (resolve) => {
        workers[workerIndex].postMessage({
          type: 'GET_BEST_GUESS',
          params: {
            checkPossibleSolutions: false,
            possibleSolutions: possibleSolutions,
            startIndex,
            endIndex,
            bestScore,
          },
        });
        const workerGuessData = await new Promise(resolve => {
          workers[workerIndex].onmessage = (e) => {
            resolve(e.data);
          };
        });
        if (workerGuessData.length > 0) {
          const workerBestScore = workerGuessData[0].stats.score;
          if (workerBestScore < bestScore) {
            guessData = workerGuessData;
            bestScore = workerBestScore;
          } else if (workerBestScore === bestScore) {
            guessData.push(...workerGuessData);
          }
        }
        resolve();
      });
    });
    await Promise.all(tasks_);
  }

  // Turn `score` into `avgSolutions`.
  for (const data of guessData) {
    data.stats.avgSolutions = data.stats.score / possibleSolutions.length;
    delete data.stats.score;
  }

  log(`${Math.round(performance.now() - start)}ms`);
  return guessData;
}

/**
 * Top 100 guesses from the output of bestGuess() sorted by `avgSolutions /
 * numGroups`.
 */
const FIRST_GUESSES = [
  'RAISE', 'ROATE', 'RAILE', 'SALET', 'REAST', 'SOARE', 'SLATE', 'CRATE',
  'TRACE', 'ORATE', 'CARTE', 'TALER', 'IRATE', 'CARLE', 'RAINE', 'RATEL',
  'ARISE', 'CARET', 'ARIEL', 'ARTEL', 'LATER', 'TASER', 'SAINE', 'SANER',
  'EARST', 'CARSE', 'STALE', 'STARE', 'SNARE', 'AROSE', 'ALTER', 'ALERT',
  'ANTRE', 'OATER', 'SLANE', 'TARES', 'RESAT', 'CRANE', 'LEAST', 'TORSE',
  'SERAL', 'LATEN', 'STRAE', 'REACT', 'PAIRE', 'LIANE', 'CATER', 'LASER',
  'REIST', 'TEARS', 'EARNT', 'LEANT', 'LEARN', 'TRINE', 'TOILE', 'URATE',
  'SLIER', 'TRADE', 'PEART', 'PRATE', 'PARSE', 'AESIR', 'COATE', 'TERAS',
  'SOREL', 'LARES', 'TRONE', 'LITRE', 'TILER', 'ALINE', 'TRAPE', 'SAICE',
  'STANE', 'RATES', 'TRAIL', 'RALES', 'ROAST', 'REALO', 'ALIEN', 'REAIS',
  'RETIA', 'ALONE', 'PARLE', 'ALURE', 'TALES', 'RANCE', 'TEALS', 'RENAL',
  'STEAR', 'THRAE', 'SETAL', 'HEART', 'SILER', 'ANILE', 'SNORE', 'AISLE',
  'ROSET', 'TRICE', 'TARED', 'PRASE'
];

/**
 * Gets a random first guess from the list of best guesses (above), weighted
 * towards the top of the list.
 */
function getFirstGuess() {
  // Sum from 1 .. num guesses
  const sum = FIRST_GUESSES.length * (FIRST_GUESSES.length + 1) / 2;
  const r = Math.floor(sum * Math.random());
  let i = 0;
  let x = 0;
  // Go until we *just* pass r, then return the guess at index i.
  while (i < FIRST_GUESSES.length) {
    x += FIRST_GUESSES.length - i;
    if (x > r) {
      return FIRST_GUESSES[i];
    }
    i++;
  }
  // shouldn't happen!
  return FIRST_GUESSES[0];
}

/** Filters the `solutions` list to those that satisfy all the given clues. */
const possibleSolutionsMemo = new Map();
function getPossibleSolutions({solutions}, ...clues) {
  if (clues.length === 0) {
    return solutions;
  }

  const key = clues.join('');
  if (possibleSolutionsMemo.has(key)) {
    return possibleSolutionsMemo.get(key);
  }

  let possibleSolutions =
      getPossibleSolutions({solutions}, ...clues.slice(0, -1));
  possibleSolutions = filterWords(possibleSolutions, clues[clues.length - 1]);

  possibleSolutionsMemo.set(key, possibleSolutions);
  return possibleSolutions;
}

/** Filters the input `words` array to those that satisfy the given clue. */
function filterWords(words, clue) {
  const regexes = buildClueRegexes(clue);
  return words.filter(word => regexes.every(regex => regex.test(word)));
}
