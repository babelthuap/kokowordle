import {El} from './util.js';

let bubble = null;

/** Logs both to the UI and to the console. */
export async function log(...args) {
  if (bubble == null) {
    bubble = newBubble();
  }
  const div = document.createElement('div');
  if (args[0].includes('%c')) {
    const spans = args[0].split('%c').map((str, i) => {
      if (i === 0) {
        return `<span>${str}</span>`;
      } else if (args[i].startsWith('background-color:teal')) {
        return `<a target="_blank" href="https://en.wiktionary.org/wiki/${
            str === 'ROATE' ?
                str :
                str.toLowerCase()}#English" style="${args[i]}">${str}</a>`;
      } else {
        return `<span style="${args[i]}">${str}</span>`;
      }
    });
    div.innerHTML = spans.join('');
    bubble.append(div);
  } else {
    const output = args.join(' ');
    if (output === '') {
      resetBubble();
    } else {
      div.innerText = output;
      bubble.append(div);
    }
  }
  console.log(...args);
  await new Promise(requestAnimationFrame);
}

/** Creates and attaches a new bubble. */
function newBubble() {
  const bubble = document.createElement('div');
  bubble.classList.add('bubble');
  El.botOutput.append(bubble);
  return bubble;
}

/** Closes out the current bubble and preps for a new one. */
export function resetBubble() {
  bubble = null;
}

/** Scrolls to the bottom of the page. */
export async function scrollToBottom() {
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
export async function logGuess(guess, clue) {
  const colors = new Array(5);
  const clueStr = new Array(10);
  for (let i = 0; i < 10; i += 2) {
    clueStr[i] = '%c';
    clueStr[i + 1] = clue.slice(i, i + 2);
    colors[i >> 1] = clueCSS[clue[i + 1]];
  }
  await log(
      `guess: %c${guess}%c ⇨ ${clueStr.join('')}`,
      'background-color:teal;color:black;',
      'background-color:unset;color:unset;', ...colors);
}
