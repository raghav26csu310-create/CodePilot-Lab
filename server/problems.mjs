/**
 * Private grading suites for the Practice Arena.
 *
 * This file never reaches the browser bundle. Hidden inputs and expected
 * outputs stay in this process; `/grade` returns only case indices, hidden
 * flags, statuses and bounded visible stderr.
 *
 * Visible cases mirror the public examples in
 * `src/features/practice/catalog.ts`. Keep both in sync when adding problems.
 */

const ALL_LANGUAGES = ['python', 'javascript', 'typescript', 'c', 'cpp', 'java']

/** @param {string} stdin @param {string} expected @param {boolean} hidden */
function t(stdin, expected, hidden) {
  return { stdin, expected, hidden }
}

export const PROBLEM_SETS = {
  'signal-peak': {
    supported: ALL_LANGUAGES,
    tests: [
      t('6\n4 9 2 9 7 1\n', '9 2', false),
      t('5\n-8 -3 -12 -3 -7\n', '-3 2', false),
      t('1\n42\n', '42 1', true),
      t('8\n0 0 0 1 1 0 1 1\n', '1 4', true),
      t('3\n100 100 100\n', '100 1', true),
      t('7\n-5 -9 -5 -2 -2 -8 -2\n', '-2 4', true),
      t('4\n2147483647 -2147483648 0 2147483647\n', '2147483647 1', true),
    ],
  },
  'mirror-words': {
    supported: ALL_LANGUAGES,
    tests: [
      t('Never odd or even\n', 'YES', false),
      t('CodePilot Lab\n', 'NO', false),
      t('A man, a plan, a canal: Panama\n', 'YES', true),
      t('\n', 'YES', true),
      t('Racecar\n', 'YES', true),
      t('Signal drift\n', 'NO', true),
      t('12321\n', 'YES', true),
      t('hello world\n', 'NO', true),
    ],
  },
  'first-light': {
    supported: ALL_LANGUAGES,
    tests: [
      t('7\n1 3 3 5 8 8 8\n8\n', '4', false),
      t('5\n2 4 6 8 10\n7\n', '-1', false),
      t('6\n1 1 1 1 1 1\n1\n', '0', true),
      t('9\n-4 -1 0 3 3 3 9 12 12\n3\n', '3', true),
      t('1\n5\n5\n', '0', true),
      t('1\n5\n4\n', '-1', true),
      t('8\n0 2 4 6 8 10 12 14\n14\n', '7', true),
      t('8\n0 2 4 6 8 10 12 14\n0\n', '0', true),
    ],
  },
  'bracket-gate': {
    supported: ALL_LANGUAGES,
    tests: [
      t('{[()]}\n', 'BALANCED', false),
      t('([)]\n', 'UNBALANCED', false),
      t('\n', 'BALANCED', true),
      t('((((\n', 'UNBALANCED', true),
      t('][\n', 'UNBALANCED', true),
      t('{{{{}}}}\n', 'BALANCED', true),
      t('([{}])[]\n', 'BALANCED', true),
      t('({[}])\n', 'UNBALANCED', true),
    ],
  },
  'longest-drift': {
    supported: ALL_LANGUAGES,
    tests: [
      t('abcabcbb\n', '3', false),
      t('bbbbb\n', '1', false),
      t('pwwkew\n', '3', true),
      t('dvdf\n', '3', true),
      t('abcdef\n', '6', true),
      t('abba\n', '2', true),
      t('tmmzuxt\n', '5', true),
      t('\n', '0', true),
      t('signal\n', '6', true),
    ],
  },
  'merge-beacons': {
    supported: ALL_LANGUAGES,
    tests: [
      t('4\n1 3\n2 6\n8 10\n9 12\n', '2\n1 6\n8 12', false),
      t('3\n5 7\n1 2\n3 4\n', '3\n1 2\n3 4\n5 7', false),
      t('1\n10 20\n', '1\n10 20', true),
      t('4\n1 10\n2 3\n4 8\n9 15\n', '1\n1 15', true),
      t('5\n1 2\n2 3\n3 4\n4 5\n5 6\n', '1\n1 6', true),
      t('3\n-5 -1\n-3 2\n8 9\n', '2\n-5 2\n8 9', true),
      t('2\n1 1\n1 1\n', '1\n1 1', true),
      t('4\n0 5\n6 7\n8 9\n10 11\n', '4\n0 5\n6 7\n8 9\n10 11', true),
    ],
  },
  'coin-relay': {
    supported: ALL_LANGUAGES,
    tests: [
      t('3\n1 2 5\n11\n', '3', false),
      t('1\n2\n3\n', '-1', false),
      t('1\n1\n0\n', '0', true),
      t('4\n1 5 6 9\n11\n', '2', true),
      t('3\n2 5 10\n27\n', '4', true),
      t('2\n3 7\n5\n', '-1', true),
      t('4\n186 419 83 408\n6249\n', '20', true),
      t('1\n7\n100\n', '-1', true),
    ],
  },
  'queens-count': {
    supported: ALL_LANGUAGES,
    tests: [
      t('4\n', '2', false),
      t('1\n', '1', false),
      t('2\n', '0', true),
      t('3\n', '0', true),
      t('5\n', '10', true),
      t('6\n', '4', true),
      t('8\n', '92', true),
      t('9\n', '352', true),
      t('7\n', '40', true),
    ],
  },
  'grid-escape': {
    supported: ALL_LANGUAGES,
    tests: [
      t('3 3\n000\n110\n000\n', '4', false),
      t('2 2\n01\n10\n', '-1', false),
      t('1 1\n0\n', '0', true),
      t('1 1\n1\n', '-1', true),
      t('3 4\n0000\n1110\n0000\n', '5', true),
      t('4 4\n0000\n0110\n0110\n0000\n', '6', true),
      t('2 3\n000\n000\n', '3', true),
      t('3 3\n000\n000\n001\n', '-1', true),
      t('3 3\n000\n010\n000\n', '4', true),
    ],
  },
  'bit-lantern': {
    supported: ALL_LANGUAGES,
    tests: [
      t('11\n', '3', false),
      t('0\n', '0', false),
      t('1\n', '1', true),
      t('255\n', '8', true),
      t('1024\n', '1', true),
      t('9223372036854775807\n', '63', true),
      t('123456789\n', '16', true),
      t('2\n', '1', true),
    ],
  },
  'greedy-ferry': {
    supported: ALL_LANGUAGES,
    tests: [
      t('5 10\n4 8 1 3 2\n', '4', false),
      t('3 5\n6 7 8\n', '0', false),
      t('4 0\n1 1 1 1\n', '0', true),
      t('5 6\n1 2 3 4 5\n', '3', true),
      t('3 6\n6 6 6\n', '1', true),
      t('6 100\n50 20 30 10 40 60\n', '4', true),
      t('1 5\n5\n', '1', true),
      t('2 3\n4 5\n', '0', true),
    ],
  },
  'linked-loop': {
    supported: ALL_LANGUAGES,
    tests: [
      t('4\n1 2 3 1\n', '1', false),
      t('3\n1 2 -1\n', '-1', false),
      t('1\n0\n', '0', true),
      t('5\n-1 -1 -1 -1 -1\n', '-1', true),
      t('5\n1 2 3 4 2\n', '2', true),
      t('6\n1 2 3 4 5 3\n', '3', true),
      t('2\n1 0\n', '0', true),
      t('2\n1 -1\n', '-1', true),
    ],
  },
  'canopy-height': {
    supported: ALL_LANGUAGES,
    tests: [
      t('5\n-1 0 0 1 1\n', '3', false),
      t('1\n-1\n', '1', false),
      t('4\n-1 0 1 2\n', '4', true),
      t('6\n-1 0 0 1 2 2\n', '3', true),
      t('7\n-1 0 1 0 1 2 2\n', '4', true),
      t('2\n-1 0\n', '2', true),
      t('5\n-1 0 1 2 3\n', '5', true),
      t('4\n-1 0 0 0\n', '2', true),
    ],
  },
}

export const PROBLEM_IDS = Object.keys(PROBLEM_SETS)
