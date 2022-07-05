answers.sort();
guesses.sort();
console.log('loaded', Math.round(performance.now()), 'ms');

const loadingSpinner = document.getElementById('loading-spinner');
const solutionInput = document.getElementById('solution-input');
const randSolution = document.getElementById('rand-solution');
const autoSolve = document.getElementById('auto-solve');
const botOutput = document.getElementById('bot-output');

loadingSpinner.classList.add('hidden');

solutionInput.addEventListener('keydown', (e) => {
  setTimeout(() => {
    if (!/^[A-Za-z]{0,5}$/.test(solutionInput.value)) {
      solutionInput.value =
          solutionInput.value.replace(/[^A-Za-z]/g, '').slice(0, 5);
    }
    if (e.key === 'Enter') {
      solve();
    }
  }, 0);
});
solutionInput.focus();

randSolution.addEventListener('click', () => {
  solutionInput.value = answers[rand(answers.length - 1)];
});
randSolution.click();

autoSolve.addEventListener('click', solve);

const nativeLog = console.log;
console.log = async function(...args) {
  const div = document.createElement('div');
  if (args[0].includes('%c')) {
    const spans = args[0].split('%c').map((str, i) => {
      if (i === 0) {
        return `<span>${str}</span>`;
      } else {
        return `<span style="${args[i]}">${str}</span>`;
      }
    });
    div.innerHTML = spans.join('');
  } else {
    const output = args.join(' ');
    if (output === '') {
      div.innerHTML = '&nbsp;';
    } else {
      div.innerText = output;
    }
  }
  botOutput.append(div);
  nativeLog(...args);
  await new Promise(requestAnimationFrame);
};

let inProgress = false;
async function solve() {
  if (inProgress) {
    return;
  }

  if (solutionInput.value.length === 0) {
    botOutput.classList.add('error');
    botOutput.innerText =
        'Please enter a solution for the KokoWordle Solver to try to guess.';
    return;
  }
  const answer = solutionInput.value.toUpperCase();
  if (!answers.includes(answer)) {
    botOutput.classList.add('error');
    botOutput.innerText = `"${answer}" is not a valid solution.`;
    return;
  }
  botOutput.classList = '';
  botOutput.innerText = '';

  inProgress = true;
  loadingSpinner.classList.remove('hidden');
  await autoplay(answer);
  inProgress = false;
  loadingSpinner.classList.add('hidden');
}

const HARDWARE_CONCURRENCY = navigator.hardwareConcurrency;
botOutput.innerText = `concurrency: ${HARDWARE_CONCURRENCY}`;

const workers = new Array(HARDWARE_CONCURRENCY);
for (let id = 0; id < HARDWARE_CONCURRENCY; id++) {
  workers[id] = new Worker('worker.js');
}

/**
 * ```
 * clue := chlu x5  concatenation of 5 "char clues"
 * chlu := `char+`  if the char is green
 *         `char?`  if the char is yellow
 *         `char-`  if the char is grey
 * ```
 * E.g. 'O?R+A-T-E-'
 */
function getClue(answer, guess) {
  const clue = new Array(5);
  const freqs = getCharFreqs(answer);
  // Mark greens
  for (let i = 0; i < 5; i++) {
    if (answer[i] === guess[i]) {
      let char = guess[i];
      clue[i] = char + '+';
      freqs[char]--;
    }
  }
  // Mark yellows and greys
  for (let i = 0; i < 5; i++) {
    if (answer[i] !== guess[i]) {
      let char = guess[i];
      if (freqs[char]) {
        clue[i] = char + '?';
        freqs[char]--;
      } else {
        clue[i] = char + '-';
      }
    }
  }
  return clue.join('');
}

const charFreqsMemo = new Map();
/** freqs := {char: count} for each char in word */
function getCharFreqs(word) {
  const freqs = {};

  if (charFreqsMemo.has(word)) {
    Object.assign(freqs, charFreqsMemo.get(word));
  } else {
    for (const c of word) {
      if (c in freqs) {
        freqs[c]++;
      } else {
        freqs[c] = 1;
      }
    }
    charFreqsMemo.set(word, Object.assign({}, freqs));
  }

  return freqs;
}

/** Filters the input `words` array to those that satisfy the given clue. */
function filterWords(words, clue) {
  const regexes = buildClueRegexes(clue);
  return words.filter(word => regexes.every(regex => regex.test(word)));
}

/** Count the elements of `words` that match the given clue. */
function countMatchingWords(words, clue) {
  const regexes = buildClueRegexes(clue);
  return words.reduce(
      (count, word) =>
          regexes.every(regex => regex.test(word)) ? count + 1 : count,
      0);
}

/** Builds a list of regexes that are equivalent to the given clue. */
const clueRegexesMemo = new Map();
function buildClueRegexes(clue) {
  if (clueRegexesMemo.has(clue)) {
    return clueRegexesMemo.get(clue);
  }

  // green clue chars
  const greens = new Array(5);
  const greenCounts = {};
  for (let i = 0; i < 10; i += 2) {
    const char = clue[i];
    const type = clue[i + 1];
    if (type === '+') {
      greens[i >> 1] = char;
      if (char in greenCounts) {
        greenCounts[char]++;
      } else {
        greenCounts[char] = 1;
      }
    }
  }

  // other clue chars
  const counts = {};
  const excluded = new Array(5);
  for (let i = 0; i < 5; i++) {
    excluded[i] = new Set();
  }
  for (let i = 0; i < 10; i += 2) {
    const char = clue[i];
    const type = clue[i + 1];
    switch (type) {
      case '?':
        excluded[i >> 1].add(char);
      // fall through
      case '+':
        if (char in counts) {
          counts[char]++;
        } else {
          counts[char] = 1;
        }
        break;
      case '-':
        if (char in counts) {
          counts[char] = -counts[char];
          excluded[i >> 1].add(char);
        } else {
          for (let j = 0; j < 5; j++) {
            if (greens[j] === undefined) {
              excluded[j].add(char);
            }
          }
        }
        break;
      default:
        throw new Error('unknown type ' + char + type);
    }
  }

  // Use what we know for sure about where chars are and aren't
  const regexParts = new Array(5);
  for (let i = 0; i < 5; i++) {
    if (greens[i]) {
      regexParts[i] = greens[i];
    } else if (excluded[i].size > 0) {
      regexParts[i] = '[^' + [...excluded[i]].join('') + ']';
    } else {
      regexParts[i] = '.';
    }
  }

  // Compress the regex by combining repeated chars
  let rawRegex = '^';
  for (let i = 0, prev = regexParts[0], multiples = 0; i < 6; i++) {
    if (regexParts[i] === prev) {
      multiples++;
    } else {
      switch (multiples) {
        case 1:
          rawRegex += prev;
          break;
        default:
          rawRegex += `${prev}{${multiples}}`;
          break;
      }
      prev = regexParts[i];
      multiples = 1;
    }
  }
  rawRegex += '$';
  const regexes = [new RegExp(rawRegex)];

  // console.log('counts', counts);
  // console.log('greenCounts', greenCounts);

  // Make sure we have the correct count of each char per the yellow clues
  for (let char in counts) {
    let count = counts[char];
    if (greenCounts[char] === count) {
      // We've already accounted for all of this char in the greens.
      // No need to double-check.
      continue;
    }
    let exact = false;
    if (count < 0) {
      count = -count;
      exact = true;
    }
    const parts = ['^', ...new Array(count).fill(char), '$'];
    const separator = exact ? `[^${char}]*` : '.*';
    regexes.push(new RegExp(parts.join(separator)));
  }

  clueRegexesMemo.set(clue, regexes);
  return regexes;
}

/** Determines the number of answers that satisfy the given clue. */
const narrowedSetSizeMemo = new Map();
function narrowedSetSize(clue) {
  if (narrowedSetSizeMemo.has(clue)) {
    return narrowedSetSizeMemo.get(clue);
  }

  const regexes = buildClueRegexes(clue);
  let n = 0;
  for (let i = 0; i < answers.length; i++) {
    if (regexes.every(regex => regex.test(answers[i]))) {
      n++;
    }
  }

  narrowedSetSizeMemo.set(clue, n);
  return n;
}

/**
 * [DEPRECATED] Finds the guess that, on average, narrows the solution space
 * the most.
 */
function bestFirstGuess(max = NaN) {
  const start = performance.now();
  const scores = [];
  for (const guess of guesses) {
    const score = answers.reduce(
        (sum, answer) => sum + narrowedSetSize(getClue(answer, guess)), 0);
    scores.push({guess, score});
    if (scores.length === max) {
      break;
    }
  }
  const out = scores.sort((a, b) => a.score - b.score);
  console.log(performance.now() - start);
  return out;
}

/** Filters the `answers` list to those that satisfy all the given clues. */
const possibleAnswersMemo = new Map();
function getPossibleAnswers(...clues) {
  if (clues.length === 0) {
    return answers;
  }

  const key = clues.join('');
  if (possibleAnswersMemo.has(key)) {
    return possibleAnswersMemo.get(key);
  }

  let possibleAnswers = getPossibleAnswers(...clues.slice(0, -1));
  possibleAnswers = filterWords(possibleAnswers, clues[clues.length - 1]);

  possibleAnswersMemo.set(key, possibleAnswers);
  return possibleAnswers;
}

/**
 * Finds the guess that, on average, narrows the word list as much as possible.
 */
function bestGuess_smallSolutionSpace(possibleAnswers = answers) {
  const start = performance.now();

  const scores = [];
  for (const guess of guesses) {
    let score = 0;
    clueRegexesMemo.clear();
    for (const answer of possibleAnswers) {
      if (answer !== guess) {
        score += countMatchingWords(possibleAnswers, getClue(answer, guess));
      }
    }
    scores.push([guess, score]);
  }

  const out = scores.sort((a, b) => a[1] - b[1]);
  console.log(performance.now() - start);
  return out;
}

/**
 * Splits `possibleAnswers` into groups based on the clue generated by `guess`.
 */
function getGroups(possibleAnswers, guess) {
  const groups = new Map();
  for (const answer of possibleAnswers) {
    const clue = getClue(answer, guess);
    const regexes = buildClueRegexes(clue);
    if (regexes.every(regex => regex.test(answer))) {
      if (groups.has(clue)) {
        groups.get(clue).push(answer);
      } else {
        groups.set(clue, [answer]);
      }
    }
  }
  return groups;
}

function getMaxGroupSize(possibleAnswers, guess) {
  const groups = {};
  for (const answer of possibleAnswers) {
    const clue = getClue(answer, guess);
    const regexes = buildClueRegexes(clue);
    if (regexes.every(regex => regex.test(answer))) {
      if (clue in groups) {
        groups[clue]++;
      } else {
        groups[clue] = 1;
      }
    }
  }
  let max = 0;
  for (clue in groups) {
    max = Math.max(max, groups[clue]);
  }
  return max;
}

function bestGuess_smallMaxGroup(possibleAnswers = answers) {
  const start = performance.now();

  const scores = [];
  for (const guess of guesses) {
    clueRegexesMemo.clear();
    const score = getMaxGroupSize(possibleAnswers, guess);
    scores.push([guess, score]);
  }

  const out = scores.sort((a, b) => a[1] - b[1]);
  console.log(performance.now() - start);
  return out;
}

function getAvgGroupSize(possibleAnswers, guess) {
  const groups = {};
  for (const answer of possibleAnswers) {
    const clue = getClue(answer, guess);
    const regexes = buildClueRegexes(clue);
    if (regexes.every(regex => regex.test(answer))) {
      if (clue in groups) {
        groups[clue]++;
      } else {
        groups[clue] = 1;
      }
    }
  }
  let total = 0;
  let count = 0;
  for (clue in groups) {
    total += groups[clue];
    count++;
  }
  return total / count;
}

function bestGuess_smallAvgGroup(possibleAnswers = answers) {
  const start = performance.now();

  const scores = [];
  for (const guess of guesses) {
    clueRegexesMemo.clear();
    const score = getAvgGroupSize(possibleAnswers, guess);
    scores.push([guess, score]);
  }

  const out = scores.sort((a, b) => a[1] - b[1]);
  console.log(performance.now() - start);
  return out;
}

/**
 * Calculates stats over all possible solutions for the given guess. Exits early
 * if the sum (i.e. the `score`) is greater than the best known score (useful
 * for finding the best guess).
 */
function getSolutionSpaceStats_earlyExit(
    possibleAnswers, guess, bestKnownScore = Infinity) {
  let score = 0;
  const groups = new Map();
  for (const answer of possibleAnswers) {
    if (guess === answer) {
      continue;
    }
    const clue = getClue(answer, guess);
    const regexes = buildClueRegexes(clue);
    if (regexes.every(regex => regex.test(answer))) {
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

/**
 * Finds the list of guesses that will minimize the size of the filtered
 * solution space.
 */
async function bestGuess_smallSolutionSpace_parallel(possibleAnswers) {
  const start = performance.now();

  let bestScore = Infinity;
  let guessData = [];

  const ranges = distributeRange(0, possibleAnswers.length);
  const tasks = ranges.map(([startIndex, endIndex], workerIndex) => {
    return new Promise(async (resolve) => {
      workers[workerIndex].postMessage({
        checkPossibleAnswers: true,
        possibleAnswers: possibleAnswers,
        startIndex,
        endIndex,
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

  // If bestScore is <= the number of possibleAnswers, then we've already found
  // the best guess. No need to check the other guesses.
  if (bestScore > possibleAnswers.length) {
    const ranges_ = distributeRange(0, answers.length);
    const tasks_ = ranges_.map(([startIndex, endIndex], workerIndex) => {
      return new Promise(async (resolve) => {
        workers[workerIndex].postMessage({
          checkPossibleAnswers: false,
          possibleAnswers: possibleAnswers,
          startIndex,
          endIndex,
          bestScore,
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
    data.stats.avgSolutions = data.stats.score / possibleAnswers.length;
    delete data.stats.score;
  }

  console.log(`${Math.round(performance.now() - start)}ms`);
  return guessData;
}

/** start and end work as in `slice` */
function distributeRange(start, end) {
  const numTasks = end - start;
  if (numTasks <= HARDWARE_CONCURRENCY) {
    // Assign one task per worker
    const ranges = new Array(numTasks);
    for (let i = 0; i < numTasks; i++) {
      ranges[i] = [start + i, start + i + 1];
    }
    return ranges;
  } else {
    // Try to distribute tasks evenly. Give the extras to the low workers.
    const ranges = new Array(HARDWARE_CONCURRENCY);
    const tasksPerWorker = Math.floor(numTasks / HARDWARE_CONCURRENCY);
    const remainder = numTasks % HARDWARE_CONCURRENCY;
    let taskIndex = 0;
    for (let i = 0; i < remainder; i++) {
      ranges[i] = [taskIndex, taskIndex + tasksPerWorker + 1];
      taskIndex += tasksPerWorker + 1;
    }
    for (let i = remainder; i < HARDWARE_CONCURRENCY; i++) {
      ranges[i] = [taskIndex, taskIndex + tasksPerWorker];
      taskIndex += tasksPerWorker;
    }
    return ranges;
  }
}

a1 = [
  'BOBBY', 'BONGO', 'BONUS', 'BOOBY', 'BOOST', 'BOOTH', 'BOOTY', 'BOOZY',
  'BOSOM', 'BOSSY', 'BOTCH', 'BOUGH', 'BOUND', 'BUDDY', 'BUGGY', 'BUNCH',
  'BUNNY', 'BUSHY', 'BUTCH', 'BUXOM', 'CHOCK', 'CHUCK', 'CHUMP', 'CHUNK',
  'COMFY', 'CONCH', 'CONDO', 'COUCH', 'COUGH', 'COUNT', 'DODGY', 'DONUT',
  'DOUBT', 'DOUGH', 'DOWDY', 'DOWNY', 'DUCHY', 'DUMMY', 'DUMPY', 'DUSKY',
  'DUSTY', 'DUTCH', 'FOCUS', 'FOGGY', 'FOUND', 'FUNKY', 'FUNNY', 'FUSSY',
  'FUZZY', 'GHOST', 'GOODY', 'GOOFY', 'GUMBO', 'GUMMY', 'GUPPY', 'GUSTO',
  'GUSTY', 'GYPSY', 'HOBBY', 'HOUND', 'HOWDY', 'HUMPH', 'HUMUS', 'HUNCH',
  'HUNKY', 'HUSKY', 'HUSSY', 'HUTCH', 'JOUST', 'JUMBO', 'JUMPY', 'JUNTO',
  'KNOCK', 'KNOWN', 'MONTH', 'MOODY', 'MOSSY', 'MOTTO', 'MOUND', 'MOUNT',
  'MOUTH', 'MUCKY', 'MUCUS', 'MUDDY', 'MUMMY', 'MUNCH', 'MUSHY', 'MUSKY',
  'MUSTY', 'NOTCH', 'NUTTY', 'NYMPH', 'OUGHT', 'OUTDO', 'OUTGO', 'PHONY',
  'PHOTO', 'POOCH', 'POPPY', 'POUCH', 'POUND', 'POUTY', 'PUDGY', 'PUFFY',
  'PUNCH', 'PUPPY', 'PUSHY', 'PUTTY', 'PYGMY', 'QUOTH', 'SCOFF', 'SCOOP',
  'SCOUT', 'SHOCK', 'SHOOK', 'SHOOT', 'SHOUT', 'SHOWN', 'SHOWY', 'SHUCK',
  'SHUNT', 'SHUSH', 'SKUNK', 'SMOCK', 'SMOKY', 'SNOOP', 'SNOUT', 'SNOWY',
  'SNUCK', 'SNUFF', 'SOGGY', 'SOOTH', 'SOOTY', 'SOUND', 'SOUTH', 'SPOOF',
  'SPOOK', 'SPOON', 'SPOUT', 'SPUNK', 'STOCK', 'STOMP', 'STONY', 'STOOD',
  'STOOP', 'STOUT', 'STUCK', 'STUDY', 'STUFF', 'STUMP', 'STUNG', 'STUNK',
  'STUNT', 'SUNNY', 'SWOON', 'SWOOP', 'SWUNG', 'SYNOD', 'THONG', 'THUMB',
  'THUMP', 'TODDY', 'TOOTH', 'TOUCH', 'TOUGH', 'UNCUT', 'VOUCH', 'WHOOP',
  'WOODY', 'WOOZY', 'WOUND', 'YOUNG', 'YOUTH'
];

/**
 * Top 47 guesses from the output of bestGuess_smallSolutionSpace_opt() sorted
 * by avgSolutions / numGroups.
 */
const FIRST_GUESSES = [
  'RAISE', 'ROATE', 'RAILE', 'SALET', 'REAST', 'SOARE', 'SLATE', 'CRATE',
  'TRACE', 'ORATE', 'CARTE', 'TALER', 'IRATE', 'CARLE', 'RAINE', 'RATEL',
  'ARISE', 'CARET', 'ARIEL', 'ARTEL', 'LATER', 'TASER', 'SAINE', 'SANER',
  'EARST', 'CARSE', 'STALE', 'STARE', 'SNARE', 'AROSE', 'ALTER', 'ALERT',
  'ANTRE', 'OATER', 'SLANE', 'TARES', 'RESAT', 'CRANE', 'LEAST', 'TORSE',
  'SERAL', 'LATEN', 'STRAE', 'REACT', 'PAIRE', 'LIANE', 'CATER'
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
    x += 47 - i;
    if (x > r) {
      return FIRST_GUESSES[i];
    }
    i++;
  }
  // shouldn't happen!
  return FIRST_GUESSES[0];
}

/** Makes a guess in one step of a Wordle game. */
async function game(...clues) {
  if (clues.length === 0) {
    const guess = getFirstGuess();
    await console.log('Here\'s a good first guess:', guess);
    return guess;
  }
  clues = clues.map(clue => clue.toUpperCase());
  const possibleAnswers = getPossibleAnswers(...clues);
  await console.log(
      `Possible answers (${possibleAnswers.length}):`,
      possibleAnswers.slice(0).sort().join(', '));
  if (possibleAnswers.length <= 2) {
    const bestGuess = possibleAnswers[rand(possibleAnswers.length - 1)];
    await console.log('Best next guess:', bestGuess);
    return bestGuess;
  }

  await console.log('Calculating...');
  await scrollToBottom();
  const topGuesses =
      await bestGuess_smallSolutionSpace_parallel(possibleAnswers);

  await console.log('Best next guesses:');
  shuffle(topGuesses);
  topGuesses.sort((a, b) => b.stats.numGroups - a.stats.numGroups);
  for (let {guess, stats} of topGuesses.slice(0, 5)) {
    const solnsFmt = Math.round(stats.avgSolutions * 100) / 100;
    await console.log(
        `${guess} - %c${solnsFmt}%c avg answers left, %c${
            stats.numGroups}%c groups`,
        'color:#9575cd', 'color:unset', 'color:#9575cd', 'color:unset');
  }
  if (topGuesses.length > 5) {
    await console.log('...');
  }
  return topGuesses[0].guess;
}

/** Plays a full game of Wordle trying to guess `answer`. */
async function autoplay(answer = answers[rand(answers.length - 1)]) {
  const start = performance.now();

  let guess = await game();
  let clues = [getClue(answer, guess)];
  await logGuess(guess, clues[0]);
  let tries = 1;
  while (guess !== answer) {
    console.log('');
    console.log('- - - - - - -');
    console.log('');
    guess = await game(...clues);
    clues.push(getClue(answer, guess));
    await logGuess(guess, clues[clues.length - 1]);
    tries++;
  }

  await console.log(
      `done in %c${tries}%c ${tries > 1 ? 'guesses' : 'guess'}, ${
          Math.round(performance.now() - start)}ms`,
      'color:#9575cd', 'color:unset');
  await scrollToBottom();
  return tries;
}

async function scrollToBottom() {
  window.scrollTo({
    top: Number.MAX_SAFE_INTEGER,
    behavior: 'smooth',
  });
  await new Promise(requestAnimationFrame);
}

const clueCSS = {
  '+': 'color:green',
  '?': 'color:orange',
  '-': 'color:unset',
};
/** Logs a guess and its resulting clue. */
async function logGuess(guess, clue) {
  const colors = new Array(5);
  const clueStr = new Array(10);
  for (let i = 0; i < 10; i += 2) {
    clueStr[i] = '%c';
    clueStr[i + 1] = clue.slice(i, i + 2);
    colors[i >> 1] = clueCSS[clue[i + 1]];
  }
  await console.log(
      `guess: %c${guess}%c ⇨ ${clueStr.join('')}`,
      'background-color:teal;color:black;',
      'background-color:unset;color:unset;', ...colors);
}

/** Shuffles an array in place. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    let j = rand(i);
    let temp = arr[j];
    arr[j] = arr[i];
    arr[i] = temp;
  }
  return arr;
};

/** Gets random int in [0, n] */
function rand(n) {
  return Math.floor((n + 1) * Math.random());
}
