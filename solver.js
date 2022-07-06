const clueRegexesMemo = new Map();

/** Builds a list of regexes that are equivalent to the given clue. */
export function buildClueRegexes(clue) {
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

/** Clears the `clueRegexesMemo` map. Use to avoid heap allocation errors. */
export function clearClueRegexesMemo() {
  clueRegexesMemo.clear();
}

/**
 * Gets a Wordle clue of the form:
 * ```
 * clue := chlu x5  concatenation of 5 "char clues"
 * chlu := `char+`  if the char is green
 *         `char?`  if the char is yellow
 *         `char-`  if the char is grey
 * ```
 * E.g. 'O?R+A-T-E-'
 */
export function getClue(solution, guess) {
  const clue = new Array(5);
  const freqs = getCharFreqs(solution);
  // Mark greens
  for (let i = 0; i < 5; i++) {
    if (solution[i] === guess[i]) {
      let char = guess[i];
      clue[i] = char + '+';
      freqs[char]--;
    }
  }
  // Mark yellows and greys
  for (let i = 0; i < 5; i++) {
    if (solution[i] !== guess[i]) {
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
