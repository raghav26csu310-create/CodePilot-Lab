/**
 * Project languages that CodePilot Lab can create, highlight, and (for the
 * executable subset) run through the local execution service.
 *
 * `runtime` is the id understood by server/executor.mjs. HTML, CSS and JSON
 * are first-class editor languages but intentionally have no runtime here.
 */

export type RuntimeLanguageId =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'c'
  | 'cpp'
  | 'java'

export type ProjectLanguageId =
  | RuntimeLanguageId
  | 'html'
  | 'css'
  | 'json'

export type ProjectLanguage = {
  id: ProjectLanguageId
  label: string
  /** Monaco language id. */
  monaco: string
  extension: string
  fileName: string
  runtime: RuntimeLanguageId | null
  /** Short honest note shown in pickers and diagnostics. */
  note: string
  starter: string
}

const PYTHON_STARTER = `"""Starter file written by CodePilot Lab."""


def main() -> None:
    print("Hello from CodePilot Lab")


if __name__ == "__main__":
    main()
`

const JAVASCRIPT_STARTER = `// Starter file written by CodePilot Lab.

function main() {
  console.log('Hello from CodePilot Lab')
}

main()
`

const TYPESCRIPT_STARTER = `// Starter file written by CodePilot Lab.

function main(): void {
  const greeting: string = 'Hello from CodePilot Lab'
  console.log(greeting)
}

main()
`

const C_STARTER = `/* Starter file written by CodePilot Lab. */
#include <stdio.h>

int main(void) {
    printf("Hello from CodePilot Lab\\n");
    return 0;
}
`

const CPP_STARTER = `// Starter file written by CodePilot Lab.
#include <iostream>

int main() {
    std::cout << "Hello from CodePilot Lab" << std::endl;
    return 0;
}
`

const JAVA_STARTER = `// Starter file written by CodePilot Lab.
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from CodePilot Lab");
    }
}
`

const HTML_STARTER = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CodePilot Lab page</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <h1>Hello from CodePilot Lab</h1>
      <p>Edit this file in the workspace and save it locally.</p>
    </main>
  </body>
</html>
`

const CSS_STARTER = `:root {
  color-scheme: dark;
  font-family: system-ui, sans-serif;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #04060b;
  color: #e9eff8;
}
`

const JSON_STARTER = `{
  "name": "codepilot-project",
  "version": "0.1.0",
  "private": true,
  "description": "Starter document written by CodePilot Lab"
}
`

export const PROJECT_LANGUAGES: ProjectLanguage[] = [
  {
    id: 'python',
    label: 'Python',
    monaco: 'python',
    extension: 'py',
    fileName: 'main.py',
    runtime: 'python',
    note: 'Runs in local Python. Real variable tracing is available.',
    starter: PYTHON_STARTER,
  },
  {
    id: 'javascript',
    label: 'JavaScript',
    monaco: 'javascript',
    extension: 'js',
    fileName: 'main.js',
    runtime: 'javascript',
    note: 'Runs on local Node.js. Tracing is not available for this language.',
    starter: JAVASCRIPT_STARTER,
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    monaco: 'typescript',
    extension: 'ts',
    fileName: 'main.ts',
    runtime: 'typescript',
    note: 'Runs through Node 24 type stripping. Enums and namespaces are unsupported by that mode.',
    starter: TYPESCRIPT_STARTER,
  },
  {
    id: 'c',
    label: 'C',
    monaco: 'c',
    extension: 'c',
    fileName: 'main.c',
    runtime: 'c',
    note: 'Compiled with local GCC. Tracing is not available for this language.',
    starter: C_STARTER,
  },
  {
    id: 'cpp',
    label: 'C++',
    monaco: 'cpp',
    extension: 'cpp',
    fileName: 'main.cpp',
    runtime: 'cpp',
    note: 'Compiled with local G++. Tracing is not available for this language.',
    starter: CPP_STARTER,
  },
  {
    id: 'java',
    label: 'Java',
    monaco: 'java',
    extension: 'java',
    fileName: 'Main.java',
    runtime: 'java',
    note: 'Compiled and run with the local JDK. The public class must match the file name.',
    starter: JAVA_STARTER,
  },
  {
    id: 'html',
    label: 'HTML',
    monaco: 'html',
    extension: 'html',
    fileName: 'index.html',
    runtime: null,
    note: 'Editor and language service only. There is no browser preview runtime in this build.',
    starter: HTML_STARTER,
  },
  {
    id: 'css',
    label: 'CSS',
    monaco: 'css',
    extension: 'css',
    fileName: 'styles.css',
    runtime: null,
    note: 'Editor and language service only. There is no rendering runtime in this build.',
    starter: CSS_STARTER,
  },
  {
    id: 'json',
    label: 'JSON',
    monaco: 'json',
    extension: 'json',
    fileName: 'data.json',
    runtime: null,
    note: 'Editor, validation and formatting only. JSON is not executed.',
    starter: JSON_STARTER,
  },
]

const BY_ID = new Map(PROJECT_LANGUAGES.map((language) => [language.id, language]))

export function projectLanguage(id: string): ProjectLanguage {
  return BY_ID.get(id as ProjectLanguageId) ?? PROJECT_LANGUAGES[0]!
}

export function runtimeLanguage(id: string): RuntimeLanguageId | null {
  return BY_ID.get(id as ProjectLanguageId)?.runtime ?? null
}

export function isExecutableLanguage(id: string): boolean {
  return runtimeLanguage(id) !== null
}

/** Maps an arbitrary editor language id (e.g. from a file extension) to a project language. */
export function projectLanguageForMonaco(monacoId: string): ProjectLanguage | null {
  return PROJECT_LANGUAGES.find((language) => language.monaco === monacoId) ?? null
}
