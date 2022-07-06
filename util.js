/** Important DOM elements */
export const El = {
  autoSolve: document.getElementById('auto-solve'),
  botOutput: document.getElementById('bot-output'),
  loadingSpinner: document.getElementById('loading-spinner'),
  randSolution: document.getElementById('rand-solution'),
  solutionInput: document.getElementById('solution-input'),
};

/** Concurrency level, which determines how many workers to create. */
export const HARDWARE_CONCURRENCY = navigator.hardwareConcurrency;
El.botOutput.innerText = `concurrency: ${HARDWARE_CONCURRENCY}`;

/**
 * Detects whether we're on a mobile device. Based on
 * https://github.com/kaimallea/isMobile
 */
export function isMobile() {
  const params = new URLSearchParams(location.search);
  if (params.has('mobile')) {
    return true;
  }

  const regexes = [
    /iPhone/i, /iPod/i, /iPad/i, /\biOS-universal(?:.+)Mac\b/i,
    /\bAndroid(?:.+)Mobile\b/i, /Android/i,
    /(?:SD4930UR|\bSilk(?:.+)Mobile\b)/i, /Silk/i, /Windows Phone/i
  ];
  return regexes.some(regex => regex.test(navigator.userAgent));
}

/** Shuffles an array in place. */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    let j = rand(i + 1);
    let temp = arr[j];
    arr[j] = arr[i];
    arr[i] = temp;
  }
  return arr;
};

/** Gets a random integer in [0, n) */
export function rand(n) {
  return Math.floor(Math.random() * n);
}

/** Start and end work as in `slice`. */
export function distributeRange(start, end) {
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
