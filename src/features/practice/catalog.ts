import type { RuntimeLanguageId } from '../editor/projectLanguages'

/**
 * Public Practice Arena catalog. Hidden inputs and expected outputs are NOT in
 * this file: they live only in server/problems.mjs and are evaluated by the
 * local grading service. Visible examples below are safe to show.
 *
 * Each id must exist in server/problems.mjs with at least the same visible
 * cases plus additional hidden cases.
 */

export type Difficulty = 'easy' | 'medium' | 'hard'

export type PracticeExample = {
  input: string
  output: string
  note?: string
}

export type PracticeTestCase = {
  stdin: string
  expected: string
}

export type PracticeProblem = {
  id: string
  title: string
  difficulty: Difficulty
  topics: string[]
  summary: string
  description: string
  inputFormat: string
  outputFormat: string
  constraints: string[]
  examples: PracticeExample[]
  visibleTests: PracticeTestCase[]
  hints: string[]
  explanation: string
  solution: {
    approach: string
    code: string
    complexity: string
  }
  starter: Record<RuntimeLanguageId, string>
}

const EXECUTABLE_LANGUAGES: RuntimeLanguageId[] = [
  'python',
  'javascript',
  'typescript',
  'c',
  'cpp',
  'java',
]

function starterCode(problem: {
  title: string
  inputFormat: string
  outputFormat: string
}): Record<RuntimeLanguageId, string> {
  const note = `// ${problem.title}\n// Input: ${problem.inputFormat}\n// Output: ${problem.outputFormat}`
  const pyNote = `"""${problem.title}\n\nInput: ${problem.inputFormat}\nOutput: ${problem.outputFormat}\n"""`

  return {
    python: `${pyNote}\nimport sys\n\n\ndef main() -> None:\n    data = sys.stdin.read().split()\n    # TODO: parse \`data\` and print the answer.\n    _ = data\n\n\nif __name__ == "__main__":\n    main()\n`,
    javascript: `${note}\nimport { readFileSync } from 'node:fs'\n\nconst data = readFileSync(0, 'utf8').trim().split(/\\s+/)\n// TODO: parse \`data\` and print the answer.\nvoid data\n`,
    typescript: `${note}\nimport { readFileSync } from 'node:fs'\n\nconst data: string[] = readFileSync(0, 'utf8').trim().split(/\\s+/)\n// TODO: parse \`data\` and print the answer.\nvoid data\n`,
    c: `/* ${problem.title}\n * Input: ${problem.inputFormat}\n * Output: ${problem.outputFormat}\n */\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n\nint main(void) {\n    /* TODO: read stdin and print the answer. */\n    return 0;\n}\n`,
    cpp: `// ${problem.title}\n// Input: ${problem.inputFormat}\n// Output: ${problem.outputFormat}\n#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // TODO: read stdin and print the answer.\n    return 0;\n}\n`,
    java: `// ${problem.title}\n// Input: ${problem.inputFormat}\n// Output: ${problem.outputFormat}\nimport java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));\n        // TODO: read stdin and print the answer.\n        reader.close();\n    }\n}\n`,
  }
}

type ProblemSeed = Omit<PracticeProblem, 'starter'> & {
  starter?: Partial<Record<RuntimeLanguageId, string>>
}

function define(seed: ProblemSeed): PracticeProblem {
  const base = starterCode(seed)
  return {
    ...seed,
    starter: {
      ...base,
      ...(seed.starter ?? {}),
    },
  }
}

export const PRACTICE_PROBLEMS: PracticeProblem[] = [
  define({
    id: 'signal-peak',
    title: 'Signal Peak',
    difficulty: 'easy',
    topics: ['Arrays', 'Mathematics'],
    summary: 'Find the strongest reading and the earliest position where it appeared.',
    description:
      'A sensor array records one integer reading per position. You must report the strongest (largest) reading and the first 1-based position where that reading occurs. Readings may be negative, and ties are resolved by the earliest position.',
    inputFormat: 'The first line contains n. The second line contains n integers separated by spaces.',
    outputFormat: 'Print the maximum reading and its first 1-based position, separated by one space.',
    constraints: ['1 ≤ n ≤ 100,000', '−2^31 ≤ reading ≤ 2^31 − 1', 'Ties use the earliest position.'],
    examples: [
      {
        input: '6\n4 9 2 9 7 1\n',
        output: '9 2',
        note: 'The maximum is 9, first seen at position 2.',
      },
      {
        input: '5\n-8 -3 -12 -3 -7\n',
        output: '-3 2',
        note: 'All readings are negative; the largest is -3 at position 2.',
      },
    ],
    visibleTests: [
      { stdin: '6\n4 9 2 9 7 1\n', expected: '9 2' },
      { stdin: '5\n-8 -3 -12 -3 -7\n', expected: '-3 2' },
    ],
    hints: [
      'Track both the best value and its index while scanning once.',
      'Start with the first reading rather than a hardcoded zero, because every reading can be negative.',
      'Only replace the stored position when a strictly larger value appears, which keeps the earliest tie.',
    ],
    explanation:
      'A single left-to-right scan is enough. Initialise the best value and best position from the first reading, then compare each later reading. Using a strict “greater than” comparison preserves the first occurrence of a tie. The array does not need to be stored, so the scan uses constant extra space.',
    solution: {
      approach: 'Scan once, keeping the best value seen and the position of its first occurrence.',
      code: `import sys\n\ndef main() -> None:\n    data = list(map(int, sys.stdin.read().split()))\n    n = data[0]\n    values = data[1:1 + n]\n    best = values[0]\n    position = 1\n    for index in range(1, n):\n        if values[index] > best:\n            best = values[index]\n            position = index + 1\n    print(best, position)\n\nif __name__ == "__main__":\n    main()\n`,
      complexity: 'Time O(n), extra space O(1).',
    },
  }),
  define({
    id: 'mirror-words',
    title: 'Mirror Words',
    difficulty: 'easy',
    topics: ['Strings', 'Two Pointers'],
    summary: 'Decide whether a line reads the same in both directions once punctuation and case are ignored.',
    description:
      'A phrase is a mirror phrase when its letters and digits read identically forwards and backwards. Ignore spaces, punctuation, and letter case. An empty phrase counts as a mirror phrase.',
    inputFormat: 'A single line of text, which may contain spaces and punctuation.',
    outputFormat: 'Print YES when the phrase is a mirror phrase, otherwise NO.',
    constraints: ['The line is at most 100,000 characters.', 'Only ASCII letters and digits are compared.', 'An empty line is a valid input.'],
    examples: [
      {
        input: 'Never odd or even\n',
        output: 'YES',
        note: 'Ignoring spaces and case: neveroddoreven.',
      },
      {
        input: 'CodePilot Lab\n',
        output: 'NO',
        note: 'The cleaned sequence does not reverse to itself.',
      },
    ],
    visibleTests: [
      { stdin: 'Never odd or even\n', expected: 'YES' },
      { stdin: 'CodePilot Lab\n', expected: 'NO' },
    ],
    hints: [
      'Build a cleaned sequence containing only lowercase letters and digits.',
      'Compare the cleaned sequence with its reverse.',
      'Two pointers from both ends avoid allocating the reversed copy.',
    ],
    explanation:
      'Normalise the line by keeping alphanumeric characters and lowercasing them. The phrase is a mirror phrase exactly when the normalised sequence equals its reverse. Because case and punctuation are discarded, “Was it a car or a cat I saw?” qualifies.',
    solution: {
      approach: 'Filter to alphanumeric lowercase characters and compare with the reverse.',
      code: `import sys\n\ntext = sys.stdin.read().rstrip('\\n')\nletters = [character.lower() for character in text if character.isalnum()]\nprint('YES' if letters == letters[::-1] else 'NO')\n`,
      complexity: 'Time O(n), space O(n).',
    },
  }),
  define({
    id: 'first-light',
    title: 'First Light',
    difficulty: 'easy',
    topics: ['Binary Search', 'Arrays'],
    summary: 'Find the first occurrence of a target in a sorted array.',
    description:
      'A sorted array may contain duplicate values. Given the array and a target, report the 0-based index of the first occurrence of the target, or -1 when it is absent. The array is sorted in non-decreasing order.',
    inputFormat: 'The first line contains n. The second line contains n sorted integers. The third line contains the target.',
    outputFormat: 'Print the 0-based index of the first occurrence, or -1.',
    constraints: ['1 ≤ n ≤ 200,000', 'Values are sorted in non-decreasing order.', 'Values fit in a signed 64-bit integer.'],
    examples: [
      {
        input: '7\n1 3 3 5 8 8 8\n8\n',
        output: '4',
        note: 'The value 8 first appears at index 4.',
      },
      {
        input: '5\n2 4 6 8 10\n7\n',
        output: '-1',
        note: '7 is not present.',
      },
    ],
    visibleTests: [
      { stdin: '7\n1 3 3 5 8 8 8\n8\n', expected: '4' },
      { stdin: '5\n2 4 6 8 10\n7\n', expected: '-1' },
    ],
    hints: [
      'A normal binary search may land on any duplicate, not the first one.',
      'When the middle value is greater than or equal to the target, keep searching the left half.',
      'Record the match, then continue left to find an earlier occurrence.',
    ],
    explanation:
      'Use a lower-bound binary search. Whenever the middle value is at least the target, move the right boundary left and remember the match; otherwise move left boundary right. The final remembered index is the first occurrence, and the loop runs in logarithmic time.',
    solution: {
      approach: 'Lower-bound binary search with a remembered match.',
      code: `import sys\n\ndef main() -> None:\n    data = list(map(int, sys.stdin.read().split()))\n    n = data[0]\n    values = data[1:1 + n]\n    target = data[1 + n]\n    low, high = 0, n - 1\n    answer = -1\n    while low <= high:\n        middle = (low + high) // 2\n        if values[middle] >= target:\n            if values[middle] == target:\n                answer = middle\n            high = middle - 1\n        else:\n            low = middle + 1\n    print(answer)\n\nif __name__ == "__main__":\n    main()\n`,
      complexity: 'Time O(log n), extra space O(1).',
    },
  }),
  define({
    id: 'bracket-gate',
    title: 'Bracket Gate',
    difficulty: 'medium',
    topics: ['Stacks', 'Strings'],
    summary: 'Check whether every opening bracket is closed in the correct order.',
    description:
      'A gate accepts a string made of round, square and curly brackets when every opening bracket has a matching closing bracket of the same type, in the correct nesting order. An empty string is accepted.',
    inputFormat: 'A single line containing only bracket characters ()[]{}; the line may be empty.',
    outputFormat: 'Print BALANCED when the string is accepted, otherwise UNBALANCED.',
    constraints: ['The string length is at most 200,000.', 'Only the six bracket characters appear.', 'An empty line is accepted.'],
    examples: [
      { input: '{[()]}\n', output: 'BALANCED', note: 'Each pair is properly nested.' },
      { input: '([)]\n', output: 'UNBALANCED', note: 'The pairs cross instead of nesting.' },
    ],
    visibleTests: [
      { stdin: '{[()]}\n', expected: 'BALANCED' },
      { stdin: '([)]\n', expected: 'UNBALANCED' },
    ],
    hints: [
      'A stack naturally models nesting.',
      'Push every opening bracket; on a closing bracket, compare with the top of the stack.',
      'Reject immediately on a mismatched top, and reject at the end if the stack is not empty.',
    ],
    explanation:
      'Scan left to right. Opening brackets are pushed. A closing bracket must match the most recent unmatched opener, which is exactly the stack top. If it does not, or the stack is empty, the string cannot be balanced. After the scan the stack must be empty.',
    solution: {
      approach: 'Stack of unmatched openers with a matching table.',
      code: `import sys\n\ntext = sys.stdin.read().strip('\\r\\n')\npairs = {')': '(', ']': '[', '}': '{'}\nstack = []\nvalid = True\nfor character in text:\n    if character in '([{':\n        stack.append(character)\n    elif character in pairs:\n        if not stack or stack[-1] != pairs[character]:\n            valid = False\n            break\n        stack.pop()\nif stack:\n    valid = False\nprint('BALANCED' if valid else 'UNBALANCED')\n`,
      complexity: 'Time O(n), space O(n).',
    },
  }),
  define({
    id: 'longest-drift',
    title: 'Longest Drift',
    difficulty: 'medium',
    topics: ['Sliding Window', 'Hashing', 'Strings'],
    summary: 'Find the longest contiguous run of characters with no repeats.',
    description:
      'Given a line of characters, report the length of the longest contiguous substring that contains no repeated character. An empty line has length 0.',
    inputFormat: 'A single line of text. Spaces are part of the text.',
    outputFormat: 'Print the length of the longest substring without repeating characters.',
    constraints: ['The line length is at most 200,000.', 'Characters are compared exactly (case-sensitive).', 'An empty line has answer 0.'],
    examples: [
      { input: 'abcabcbb\n', output: '3', note: '“abc” is the longest non-repeating run.' },
      { input: 'bbbbb\n', output: '1', note: 'Every run of length 2 repeats b.' },
    ],
    visibleTests: [
      { stdin: 'abcabcbb\n', expected: '3' },
      { stdin: 'bbbbb\n', expected: '1' },
    ],
    hints: [
      'Maintain a window that is always free of duplicates.',
      'When a duplicate enters, move the left edge just past its previous occurrence.',
      'A map from character to its last index avoids scanning the window repeatedly.',
    ],
    explanation:
      'The sliding window keeps a duplicate-free range. For each right edge, if the character was seen inside the current window, jump the left edge past that occurrence; then update its last position and the best length. Each character is processed once.',
    solution: {
      approach: 'Sliding window with a last-seen index map.',
      code: `import sys\n\ntext = sys.stdin.read().rstrip('\\n')\nlast = {}\nleft = 0\nbest = 0\nfor right, character in enumerate(text):\n    if character in last and last[character] >= left:\n        left = last[character] + 1\n    last[character] = right\n    best = max(best, right - left + 1)\nprint(best)\n`,
      complexity: 'Time O(n), space O(k) where k is the character set size.',
    },
  }),
  define({
    id: 'merge-beacons',
    title: 'Merge Beacons',
    difficulty: 'medium',
    topics: ['Sorting', 'Arrays'],
    summary: 'Combine overlapping signal ranges and print the merged set.',
    description:
      'Each beacon covers the inclusive range [start, end]. Merge every pair of ranges that overlaps or touches, then print the merged ranges in increasing order of their start.',
    inputFormat: 'The first line contains n, then n lines each contain two integers start and end.',
    outputFormat: 'Print m on the first line, then m lines with the merged ranges. Ranges are inclusive and sorted by start.',
    constraints: ['1 ≤ n ≤ 100,000', 'start ≤ end', 'Ranges that share an endpoint are merged.'],
    examples: [
      { input: '4\n1 3\n2 6\n8 10\n9 12\n', output: '2\n1 6\n8 12', note: 'The first two and last two ranges merge.' },
      { input: '3\n5 7\n1 2\n3 4\n', output: '3\n1 2\n3 4\n5 7', note: 'Nothing overlaps; sorting is still required.' },
    ],
    visibleTests: [
      { stdin: '4\n1 3\n2 6\n8 10\n9 12\n', expected: '2\n1 6\n8 12' },
      { stdin: '3\n5 7\n1 2\n3 4\n', expected: '3\n1 2\n3 4\n5 7' },
    ],
    hints: [
      'Sort ranges by their start before merging.',
      'A running merged range only needs its end compared with the next start.',
      'When the next start is greater than the current end, close the current range and begin a new one.',
    ],
    explanation:
      'After sorting by start, any range that overlaps the current merged range must begin no later than its end. Extend the end with the maximum, or close the range and start a new one. The result is naturally sorted.',
    solution: {
      approach: 'Sort by start and merge with a running end.',
      code: `import sys\n\ndef main() -> None:\n    data = list(map(int, sys.stdin.read().split()))\n    n = data[0]\n    ranges = sorted((data[1 + 2 * i], data[2 + 2 * i]) for i in range(n))\n    merged = []\n    for start, end in ranges:\n        if merged and start <= merged[-1][1]:\n            merged[-1] = (merged[-1][0], max(merged[-1][1], end))\n        else:\n            merged.append((start, end))\n    print(len(merged))\n    for start, end in merged:\n        print(start, end)\n\nif __name__ == "__main__":\n    main()\n`,
      complexity: 'Time O(n log n), space O(n).',
    },
  }),
  define({
    id: 'coin-relay',
    title: 'Coin Relay',
    difficulty: 'medium',
    topics: ['Dynamic Programming', 'Arrays'],
    summary: 'Find the fewest coins needed to reach an exact total.',
    description:
      'You have unlimited copies of each coin denomination. Find the minimum number of coins whose values add up to the target amount, or -1 when the amount cannot be formed. Amount 0 needs 0 coins.',
    inputFormat: 'The first line contains n. The second line contains n distinct denominations. The third line contains the target amount.',
    outputFormat: 'Print the minimum coin count, or -1.',
    constraints: ['1 ≤ n ≤ 100', '1 ≤ denomination ≤ 10,000', '0 ≤ target ≤ 20,000'],
    examples: [
      { input: '3\n1 2 5\n11\n', output: '3', note: '5 + 5 + 1 uses three coins.' },
      { input: '1\n2\n3\n', output: '-1', note: 'Odd totals cannot be formed from coins of value 2.' },
    ],
    visibleTests: [
      { stdin: '3\n1 2 5\n11\n', expected: '3' },
      { stdin: '1\n2\n3\n', expected: '-1' },
    ],
    hints: [
      'Let dp[x] be the minimum coins for amount x.',
      'dp[0] is 0; every other amount starts as unreachable.',
      'For each amount, try every coin and build on the already-solved smaller amount.',
    ],
    explanation:
      'This is unbounded coin change. Iterate amounts upward so each coin can be reused. For amount x and coin c, dp[x] = min(dp[x], dp[x−c] + 1). Unreachable amounts stay marked and print as -1.',
    solution: {
      approach: 'Bottom-up dynamic programming over the amount.',
      code: `import sys\n\ndef main() -> None:\n    data = list(map(int, sys.stdin.read().split()))\n    n = data[0]\n    coins = data[1:1 + n]\n    amount = data[1 + n]\n    infinity = amount + 1\n    dp = [0] + [infinity] * amount\n    for value in range(1, amount + 1):\n        for coin in coins:\n            if coin <= value and dp[value - coin] + 1 < dp[value]:\n                dp[value] = dp[value - coin] + 1\n    print(-1 if dp[amount] == infinity else dp[amount])\n\nif __name__ == "__main__":\n    main()\n`,
      complexity: 'Time O(amount × n), space O(amount).',
    },
  }),
  define({
    id: 'queens-count',
    title: 'Queens Count',
    difficulty: 'hard',
    topics: ['Recursion', 'Backtracking'],
    summary: 'Count how many ways n queens can be placed without attacking each other.',
    description:
      'Place n queens on an n×n board so that no two share a row, column or diagonal. Print the number of distinct placements.',
    inputFormat: 'A single integer n.',
    outputFormat: 'Print the number of valid placements.',
    constraints: ['1 ≤ n ≤ 9', 'Queens attack along rows, columns and both diagonals.'],
    examples: [
      { input: '4\n', output: '2', note: 'Two distinct 4-queen placements exist.' },
      { input: '1\n', output: '1', note: 'A single queen is always valid.' },
    ],
    visibleTests: [
      { stdin: '4\n', expected: '2' },
      { stdin: '1\n', expected: '1' },
    ],
    hints: [
      'Place one queen per row, choosing a column for each row.',
      'Track used columns and both diagonal families instead of checking the whole board.',
      'A diagonal is identified by row − column for one direction and row + column for the other.',
    ],
    explanation:
      'Backtracking places queens row by row. Three boolean sets reject a column, a descending diagonal and an ascending diagonal in constant time. When all rows are filled, one solution is counted. The search space is small for n ≤ 9.',
    solution: {
      approach: 'Row-by-row backtracking with column and diagonal sets.',
      code: `import sys\n\ndef main() -> None:\n    n = int(sys.stdin.read().split()[0])\n    columns = set()\n    descending = set()\n    ascending = set()\n    total = 0\n\n    def place(row: int) -> None:\n        nonlocal total\n        if row == n:\n            total += 1\n            return\n        for column in range(n):\n            if column in columns or row - column in descending or row + column in ascending:\n                continue\n            columns.add(column)\n            descending.add(row - column)\n            ascending.add(row + column)\n            place(row + 1)\n            columns.remove(column)\n            descending.remove(row - column)\n            ascending.remove(row + column)\n\n    place(0)\n    print(total)\n\nif __name__ == "__main__":\n    main()\n`,
      complexity: 'Time O(n!) worst case with pruning, space O(n).',
    },
  }),
  define({
    id: 'grid-escape',
    title: 'Grid Escape',
    difficulty: 'hard',
    topics: ['Graphs', 'Queues'],
    summary: 'Find the shortest safe path across a grid of open cells and walls.',
    description:
      'A grid contains open cells (0) and walls (1). Starting at the top-left cell, find the minimum number of four-directional steps needed to reach the bottom-right cell. Start and destination must be open. Print -1 when no path exists.',
    inputFormat: 'The first line contains rows and columns. The next rows lines each contain a string of rows×columns characters made of 0 and 1.',
    outputFormat: 'Print the minimum number of steps, or -1.',
    constraints: ['1 ≤ rows, columns ≤ 500', '0 means open, 1 means wall', 'Movement is up, down, left or right; diagonal moves are not allowed.'],
    examples: [
      { input: '3 3\n000\n110\n000\n', output: '4', note: 'A valid route is down, down, right, right.' },
      { input: '2 2\n01\n10\n', output: '-1', note: 'Neither the start nor the destination can connect.' },
    ],
    visibleTests: [
      { stdin: '3 3\n000\n110\n000\n', expected: '4' },
      { stdin: '2 2\n01\n10\n', expected: '-1' },
    ],
    hints: [
      'Every step has the same cost, so breadth-first search gives the shortest path.',
      'Store the distance from the start when a cell is first reached.',
      'If the start or destination is a wall, the answer is immediately -1.',
    ],
    explanation:
      'Breadth-first search explores cells in increasing distance order. Mark cells when they enter the queue so each cell is processed once. Reaching the destination gives the minimum step count; exhausting the queue means it is unreachable.',
    solution: {
      approach: 'Breadth-first search from the top-left cell.',
      code: `import sys\nfrom collections import deque\n\ndef main() -> None:\n    lines = sys.stdin.read().splitlines()\n    rows, columns = map(int, lines[0].split())\n    grid = [line.strip() for line in lines[1:1 + rows]]\n    if grid[0][0] == '1' or grid[rows - 1][columns - 1] == '1':\n        print(-1)\n        return\n    distance = [[-1] * columns for _ in range(rows)]\n    distance[0][0] = 0\n    queue = deque([(0, 0)])\n    while queue:\n        row, column = queue.popleft()\n        if row == rows - 1 and column == columns - 1:\n            print(distance[row][column])\n            return\n        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):\n            nr, nc = row + dr, column + dc\n            if 0 <= nr < rows and 0 <= nc < columns and grid[nr][nc] == '0' and distance[nr][nc] == -1:\n                distance[nr][nc] = distance[row][column] + 1\n                queue.append((nr, nc))\n    print(-1)\n\nif __name__ == "__main__":\n    main()\n`,
      complexity: 'Time O(rows × columns), space O(rows × columns).',
    },
  }),
  define({
    id: 'bit-lantern',
    title: 'Bit Lantern',
    difficulty: 'medium',
    topics: ['Bit Manipulation', 'Mathematics'],
    summary: 'Count how many binary bits are switched on in a large integer.',
    description:
      'A lantern control word is a non-negative integer up to the signed 64-bit range. Count how many 1 bits appear in its binary representation.',
    inputFormat: 'A single non-negative integer n.',
    outputFormat: 'Print the number of set bits.',
    constraints: ['0 ≤ n ≤ 2^63 − 1', 'The value fits in a signed 64-bit integer.'],
    examples: [
      { input: '11\n', output: '3', note: '11 is 1011 in binary.' },
      { input: '0\n', output: '0', note: 'Zero has no set bits.' },
    ],
    visibleTests: [
      { stdin: '11\n', expected: '3' },
      { stdin: '0\n', expected: '0' },
    ],
    hints: [
      'Repeatedly inspect the lowest bit and shift right.',
      'The expression n & (n − 1) clears exactly one set bit.',
      'Either method runs in time proportional to the number of bits.',
    ],
    explanation:
      'Using n & (n − 1) removes the lowest set bit each iteration, so the loop count is the number of ones rather than the bit width. For JavaScript, convert with BigInt to avoid losing precision above 2^53.',
    solution: {
      approach: 'Clear the lowest set bit until the value reaches zero.',
      code: `import sys\n\ndef main() -> None:\n    n = int(sys.stdin.read().split()[0])\n    count = 0\n    while n:\n        n &= n - 1\n        count += 1\n    print(count)\n\nif __name__ == "__main__":\n    main()\n`,
      complexity: 'Time O(number of set bits), space O(1).',
    },
  }),
  define({
    id: 'greedy-ferry',
    title: 'Greedy Ferry',
    difficulty: 'medium',
    topics: ['Greedy Algorithms', 'Sorting'],
    summary: 'Carry the greatest number of crates without exceeding the weight budget.',
    description:
      'A ferry can carry a limited total weight. Each crate has a positive weight and all crates have equal value. Choose the largest possible number of crates that fit within the budget. The ferry may take any subset.',
    inputFormat: 'The first line contains n and the weight budget. The second line contains n crate weights.',
    outputFormat: 'Print the maximum number of crates that can be carried.',
    constraints: ['1 ≤ n ≤ 100,000', '0 ≤ budget ≤ 10^9', '1 ≤ weight ≤ 10^9'],
    examples: [
      { input: '5 10\n4 8 1 3 2\n', output: '4', note: 'Crates 1, 2, 3 and 4 weigh exactly 10.' },
      { input: '3 5\n6 7 8\n', output: '0', note: 'No crate fits.' },
    ],
    visibleTests: [
      { stdin: '5 10\n4 8 1 3 2\n', expected: '4' },
      { stdin: '3 5\n6 7 8\n', expected: '0' },
    ],
    hints: [
      'To maximise the count, spend as little weight as possible per crate.',
      'Sort the weights ascending.',
      'Take crates in sorted order until the next one would exceed the budget.',
    ],
    explanation:
      'For a fixed number k of crates, the smallest possible total weight is the sum of the k lightest crates. Sorting and accumulating therefore maximises the count. Stop before the running sum exceeds the budget.',
    solution: {
      approach: 'Sort ascending and take the lightest crates greedily.',
      code: `import sys\n\ndef main() -> None:\n    data = list(map(int, sys.stdin.read().split()))\n    n, budget = data[0], data[1]\n    weights = sorted(data[2:2 + n])\n    total = 0\n    count = 0\n    for weight in weights:\n        if total + weight > budget:\n            break\n        total += weight\n        count += 1\n    print(count)\n\nif __name__ == "__main__":\n    main()\n`,
      complexity: 'Time O(n log n), space O(n).',
    },
  }),
  define({
    id: 'linked-loop',
    title: 'Linked Loop',
    difficulty: 'hard',
    topics: ['Linked Lists', 'Two Pointers'],
    summary: 'Detect whether a functional graph contains a cycle and report where it starts.',
    description:
      'A linked structure is described by a next array: next[i] is the index of the node after i, or -1 for the end. Determine whether the chain starting at node 0 enters a cycle. If it does, print the 0-based index where the cycle begins; otherwise print -1.',
    inputFormat: 'The first line contains n. The second line contains n integers, each either a valid index or -1.',
    outputFormat: 'Print the cycle start index, or -1.',
    constraints: ['1 ≤ n ≤ 200,000', 'Each next value is -1 or an index in [0, n−1]', 'The path begins at node 0.'],
    examples: [
      { input: '4\n1 2 3 1\n', output: '1', note: '0 → 1 → 2 → 3 → 1, so the cycle begins at 1.' },
      { input: '3\n1 2 -1\n', output: '-1', note: 'The chain ends at -1.' },
    ],
    visibleTests: [
      { stdin: '4\n1 2 3 1\n', expected: '1' },
      { stdin: '3\n1 2 -1\n', expected: '-1' },
    ],
    hints: [
      'Follow next from node 0 and remember the first step at which each node was seen.',
      'A repeated node marks the cycle start; a -1 marks the end.',
      'Floyd’s two-pointer method finds a meeting point, then a second walk finds the entrance.',
    ],
    explanation:
      'Walking from node 0, either the chain ends or some node repeats. The first repeated node is the cycle entrance. A visited map from node to step gives it directly; the two-pointer variant uses constant extra space but needs a second phase to locate the entrance.',
    solution: {
      approach: 'Walk the chain, recording the first visit index of each node.',
      code: `import sys\n\ndef main() -> None:\n    data = list(map(int, sys.stdin.read().split()))\n    n = data[0]\n    links = data[1:1 + n]\n    seen = {}\n    node = 0\n    step = 0\n    while node != -1 and node not in seen:\n        seen[node] = step\n        node = links[node]\n        step += 1\n    print(node if node != -1 else -1)\n\nif __name__ == "__main__":\n    main()\n`,
      complexity: 'Time O(n), space O(n) with the visited map.',
    },
  }),
  define({
    id: 'canopy-height',
    title: 'Canopy Height',
    difficulty: 'medium',
    topics: ['Trees', 'Recursion'],
    summary: 'Measure the height of a rooted tree described by parent indices.',
    description:
      'A rooted tree is given as a parent array: parent[i] is the parent of node i, and exactly one node has parent -1 (the root). The height is the number of nodes on the longest path from the root to any node. A single-node tree has height 1.',
    inputFormat: 'The first line contains n. The second line contains n parent indices; -1 marks the root.',
    outputFormat: 'Print the tree height in nodes.',
    constraints: ['1 ≤ n ≤ 200,000', 'Exactly one root (-1)', 'The structure is a valid tree with no cycles.'],
    examples: [
      { input: '5\n-1 0 0 1 1\n', output: '3', note: 'The deepest path is root → 1 → 3.' },
      { input: '1\n-1\n', output: '1', note: 'A single node has height 1.' },
    ],
    visibleTests: [
      { stdin: '5\n-1 0 0 1 1\n', expected: '3' },
      { stdin: '1\n-1\n', expected: '1' },
    ],
    hints: [
      'Every node’s depth is one more than its parent’s depth.',
      'The root has depth 1.',
      'Compute depths iteratively with a stack or memoisation so a deep chain does not overflow recursion.',
    ],
    explanation:
      'The height is the maximum depth. Resolve each node by walking to its parent until a known depth is reached, then fill the path back. Memoisation makes each node contribute O(1) amortised work. A chain of 200,000 nodes requires an iterative approach.',
    solution: {
      approach: 'Memoised iterative depth computation, then take the maximum.',
      code: `import sys\n\ndef main() -> None:\n    data = list(map(int, sys.stdin.read().split()))\n    n = data[0]\n    parents = data[1:1 + n]\n    depth = [0] * n\n    best = 0\n    for start in range(n):\n        if depth[start] != 0:\n            continue\n        path = []\n        node = start\n        while node != -1 and depth[node] == 0:\n            path.append(node)\n            node = parents[node]\n        base = depth[node] if node != -1 else 0\n        for node in reversed(path):\n            base += 1\n            depth[node] = base\n        best = max(best, max((depth[node] for node in path), default=0))\n    print(best)\n\nif __name__ == "__main__":\n    main()\n`,
      complexity: 'Time O(n), space O(n).',
    },
  }),
]

export const PRACTICE_BY_ID = new Map(
  PRACTICE_PROBLEMS.map((problem) => [problem.id, problem]),
)

export function getPracticeProblem(id: string): PracticeProblem | undefined {
  return PRACTICE_BY_ID.get(id)
}

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
}

export const EXECUTABLE_PRACTICE_LANGUAGES = EXECUTABLE_LANGUAGES
