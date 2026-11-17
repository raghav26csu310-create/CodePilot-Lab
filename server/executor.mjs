import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Local execution core for CodePilot Lab.
 *
 * Constraints that shape this file:
 * - Nothing runs in the browser process, and no command ever goes through a
 *   shell string. Every command is an argument array and every job gets a
 *   fresh temp directory that is deleted afterwards.
 * - This is a resource-limited local runner, not a security boundary. The UI
 *   says exactly that. Only run code you would run in your own terminal.
 * - Every value returned here (duration, exit code, streams) comes from a real
 *   child process. Missing runtimes produce `unsupported`, never fake output.
 */

export const LIMITS = {
  maxCodeChars: 200_000,
  maxStdinChars: 64_000,
  maxStdoutChars: 96_000,
  maxStderrChars: 48_000,
  compileTimeoutMs: 20_000,
  runTimeoutMs: 8_000,
  maxTests: 16,
  maxTraceEvents: 2_500,
  projectMaxFiles: 120,
  projectMaxBytes: 800_000,
}

export const LANGUAGE_INFO = {
  python: { label: 'Python', extension: 'py', kind: 'interpreted' },
  javascript: { label: 'JavaScript', extension: 'js', kind: 'interpreted' },
  typescript: { label: 'TypeScript', extension: 'ts', kind: 'interpreted' },
  c: { label: 'C', extension: 'c', kind: 'compiled' },
  cpp: { label: 'C++', extension: 'cpp', kind: 'compiled' },
  java: { label: 'Java', extension: 'java', kind: 'compiled' },
}

export const LANGUAGE_IDS = Object.keys(LANGUAGE_INFO)

const isWindows = process.platform === 'win32'
const TRACE_HARNESS = fileURLToPath(new URL('./trace_python.py', import.meta.url))

/** Live child processes, keyed by a client job id, so Stop is a real kill. */
const ACTIVE_JOBS = new Map()

export function cancelJob(jobId) {
  if (typeof jobId !== 'string' || !jobId) {
    return { cancelled: false, message: 'No job id was provided.' }
  }
  const child = ACTIVE_JOBS.get(jobId)
  if (!child) {
    return { cancelled: false, message: 'No running process is registered for that job id.' }
  }
  child.cancelRequested = true
  killTree(child)
  ACTIVE_JOBS.delete(jobId)
  return { cancelled: true, message: 'Stop sent to the process tree.' }
}

/** Stops every registered child process. Used on server shutdown. */
export function cancelAllJobs() {
  for (const [jobId, child] of ACTIVE_JOBS) {
    child.cancelRequested = true
    killTree(child)
    ACTIVE_JOBS.delete(jobId)
  }
}

const PROBES = {
  node: { command: 'node', args: ['--version'], runtimeFor: ['javascript', 'typescript'], label: 'Node.js' },
  gcc: { command: 'gcc', args: ['--version'], runtimeFor: ['c'], label: 'GCC' },
  gpp: { command: 'g++', args: ['--version'], runtimeFor: ['cpp'], label: 'G++' },
  javac: { command: 'javac', args: ['-version'], runtimeFor: ['java'], label: 'javac' },
  java: { command: 'java', args: ['-version'], runtimeFor: ['java'], label: 'java' },
}

let pythonExecutable = null

/**
 * The Windows Store `python.exe` alias can be an installer stub, so resolve
 * the real interpreter once through the `py` launcher when possible. This is
 * still a real probe: if nothing resolves, the `python` alias is tried and the
 * runtime is reported unavailable if it cannot answer.
 */
async function resolvePythonExecutable() {
  if (pythonExecutable) {
    return pythonExecutable
  }
  if (!isWindows) {
    pythonExecutable = 'python3'
    return pythonExecutable
  }
  const result = await spawnProcess('py', ['-0p'], {
    cwd: tmpdir(),
    env: { ...process.env },
    timeoutMs: 6_000,
    stdin: '',
  })
  const match = `${result.stdout}\n${result.stderr}`.match(/([A-Za-z]:\\[^\r\n]*?python\.exe)/i)
  pythonExecutable = match?.[1]?.trim() || 'python'
  return pythonExecutable
}

function baseEnv(cwd) {
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: cwd,
    USERPROFILE: cwd,
    TEMP: cwd,
    TMP: cwd,
    TMPDIR: cwd,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    NO_COLOR: '1',
  }
  if (isWindows) {
    env.SystemRoot = process.env.SystemRoot ?? 'C:\\Windows'
    env.windir = process.env.windir ?? env.SystemRoot
    env.COMSPEC = process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe'
    env.PATHEXT = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
  }
  return env
}

export function clip(value, limit) {
  if (!value || value.length <= limit) {
    return value
  }
  return `${value.slice(0, limit)}\n… output truncated at ${limit} characters`
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  if (isWindows && child.pid) {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.on('error', () => {
        try {
          child.kill()
        } catch {
          // Already gone.
        }
      })
      return
    } catch {
      // Fall through to a direct kill.
    }
  }
  try {
    child.kill('SIGKILL')
  } catch {
    // Already gone.
  }
}

/**
 * Spawns one process, collects bounded stdout/stderr, and returns the real
 * duration measured with a monotonic clock. `performance` is a Node global.
 */
function spawnProcess(command, args, options) {
  return new Promise((resolve) => {
    const startedAt = performance.now()
    let stdout = ''
    let stderr = ''
    let settled = false
    let killedByLimit = false

    const finish = (payload) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (options.jobId && ACTIVE_JOBS.get(options.jobId) === child) {
        ACTIVE_JOBS.delete(options.jobId)
      }
      resolve({
        durationMs: Math.round(performance.now() - startedAt),
        ...payload,
      })
    }

    let child
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      if (options.jobId) {
        ACTIVE_JOBS.set(options.jobId, child)
      }
    } catch (error) {
      resolve({
        status: 'unsupported',
        stdout: '',
        stderr: '',
        exitCode: null,
        signal: null,
        durationMs: 0,
        timedOut: false,
        spawnError: error instanceof Error ? error.message : String(error),
      })
      return
    }

    const timer = setTimeout(() => {
      killedByLimit = true
      killTree(child)
    }, options.timeoutMs)

    child.stdout?.on('data', (chunk) => {
      if (stdout.length < LIMITS.maxStdoutChars) {
        stdout += chunk.toString('utf8')
      }
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < LIMITS.maxStderrChars) {
        stderr += chunk.toString('utf8')
      }
    })

    child.on('error', (error) => {
      finish({
        status: 'unsupported',
        stdout: clip(stdout, LIMITS.maxStdoutChars),
        stderr: clip(stderr, LIMITS.maxStderrChars),
        exitCode: null,
        signal: null,
        timedOut: false,
        spawnError: error.message,
      })
    })

    child.on('close', (code, signal) => {
      finish({
        status: child.cancelRequested ? 'cancelled' : killedByLimit ? 'timeout' : 'completed',
        stdout: clip(stdout, LIMITS.maxStdoutChars),
        stderr: clip(stderr, LIMITS.maxStderrChars),
        exitCode: code,
        signal,
        timedOut: killedByLimit,
        spawnError: null,
      })
    })

    try {
      if (options.stdin) {
        child.stdin?.write(options.stdin)
      }
      child.stdin?.end()
    } catch {
      // The process may exit before reading stdin.
    }
  })
}

async function probe(command, args) {
  const result = await spawnProcess(command, args, {
    cwd: tmpdir(),
    env: baseEnv(tmpdir()),
    timeoutMs: 8_000,
    stdin: '',
  })
  if (result.status !== 'completed') {
    return { ok: false, version: null }
  }
  const text = `${result.stdout}\n${result.stderr}`.trim()
  const first = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? ''
  return { ok: true, version: first.slice(0, 140) }
}

let runtimeCache = null

export async function detectRuntimes(force = false) {
  if (runtimeCache && !force) {
    return runtimeCache
  }
  const python = await resolvePythonExecutable()
  const probes = {
    ...PROBES,
    python: {
      command: python,
      args: ['-I', '-c', 'import sys; print(sys.version.split()[0])'],
      runtimeFor: ['python'],
      label: 'Python',
    },
  }
  const entries = await Promise.all(
    Object.entries(probes).map(async ([key, definition]) => [
      key,
      { ...(await probe(definition.command, definition.args)), label: definition.label },
    ]),
  )
  runtimeCache = Object.fromEntries(entries)
  return runtimeCache
}

function runtimeReady(runtimes, language) {
  if (language === 'python') return runtimes.python?.ok === true
  if (language === 'javascript' || language === 'typescript') return runtimes.node?.ok === true
  if (language === 'c') return runtimes.gcc?.ok === true
  if (language === 'cpp') return runtimes.gpp?.ok === true
  if (language === 'java') return runtimes.javac?.ok === true && runtimes.java?.ok === true
  return false
}

/** Health payload: only runtime facts that were actually probed. */
export async function healthReport() {
  const runtimes = await detectRuntimes()
  const languages = LANGUAGE_IDS.map((id) => ({
    id,
    label: LANGUAGE_INFO[id].label,
    extension: LANGUAGE_INFO[id].extension,
    executable: runtimeReady(runtimes, id),
    tracer: id === 'python',
  }))
  return {
    ok: true,
    service: 'codepilot-executor',
    platform: process.platform,
    limits: LIMITS,
    runtimes: Object.fromEntries(
      Object.entries(runtimes).map(([key, value]) => [key, { ok: value.ok, version: value.version }]),
    ),
    languages,
    tracing: {
      languages: languages.filter((language) => language.tracer).map((language) => language.id),
      note:
        'Variable tracing uses real Python sys.settrace instrumentation. No other language is traced in this build, and no values are simulated.',
    },
  }
}

function javaClassName(code) {
  const match = code.match(
    /\bpublic\s+(?:final\s+|abstract\s+|sealed\s+|non-sealed\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/,
  )
  const packageName = code.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1]
  const className = match?.[1] ?? 'Main'
  return packageName ? `${packageName}.${className}` : className
}

function sourceFile(language, javaName) {
  if (language === 'python') return 'main.py'
  if (language === 'javascript') return 'main.js'
  if (language === 'typescript') return 'main.ts'
  if (language === 'c') return 'main.c'
  if (language === 'cpp') return 'main.cpp'
  return `${javaName.replace(/\./g, '/')}.java`
}

function normalizedProjectPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    return null
  }
  const normalized = value.replace(/\\/g, '/')
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    return null
  }
  return normalized
}

function validateProjectFiles(body) {
  if (body.projectFiles === undefined) {
    return null
  }
  if (!Array.isArray(body.projectFiles) || body.projectFiles.length === 0) {
    return 'projectFiles must be a non-empty array.'
  }
  if (body.projectFiles.length > LIMITS.projectMaxFiles) {
    return `At most ${LIMITS.projectMaxFiles} project files can be staged.`
  }
  const entryPath = normalizedProjectPath(body.entryPath)
  if (!entryPath) {
    return 'entryPath must be a safe project-relative file path.'
  }
  const seen = new Set()
  let totalBytes = 0
  let entryContent = null
  for (const file of body.projectFiles) {
    const path = normalizedProjectPath(file?.path)
    if (!path || typeof file?.content !== 'string') {
      return 'Each project file needs a safe relative path and string content.'
    }
    const key = process.platform === 'win32' ? path.toLocaleLowerCase() : path
    if (seen.has(key)) {
      return `Duplicate project file path: ${path}.`
    }
    seen.add(key)
    totalBytes += Buffer.byteLength(file.content, 'utf8')
    if (totalBytes > LIMITS.projectMaxBytes) {
      return `Project snapshot exceeds the ${LIMITS.projectMaxBytes} byte limit.`
    }
    if (path === entryPath) {
      entryContent = file.content
    }
  }
  if (entryContent === null) {
    return 'entryPath must identify a file in projectFiles.'
  }
  if (entryContent !== body.code) {
    return 'code must match the selected entry file content.'
  }
  return null
}

async function writeSource(language, code, dir, entryPath, projectFiles) {
  const javaName = language === 'java' ? javaClassName(code) : 'Main'
  const file = entryPath ?? sourceFile(language, javaName)
  if (projectFiles) {
    for (const projectFile of projectFiles) {
      const path = normalizedProjectPath(projectFile.path)
      const target = join(dir, ...path.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, projectFile.content, 'utf8')
    }
  } else {
    await writeFile(join(dir, file), code, 'utf8')
  }
  return { file, javaName }
}

function compileSpec(language, javaName, entryFile) {
  if (language === 'c') {
    return { command: 'gcc', args: [entryFile, '-O1', '-std=c17', '-o', 'main.exe'] }
  }
  if (language === 'cpp') {
    return { command: 'g++', args: [entryFile, '-O1', '-std=c++17', '-o', 'main.exe'] }
  }
  if (language === 'java') {
    return {
      command: 'javac',
      args: ['-J-Xmx256m', '-encoding', 'UTF-8', '-sourcepath', '.', '-d', '.', entryFile],
    }
  }
  return null
}

async function compileIfNeeded(language, dir, javaName, entryFile, env, jobId) {
  const spec = compileSpec(language, javaName, entryFile)
  if (!spec) {
    return { ok: true, compile: null }
  }

  const result = await spawnProcess(spec.command, spec.args, {
    cwd: dir,
    env,
    timeoutMs: LIMITS.compileTimeoutMs,
    stdin: '',
    jobId,
  })

  const compile = {
    command: spec.command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
    memoryLimit: language === 'java' ? 'javac -J-Xmx256m' : null,
  }

  if (result.status === 'unsupported') {
    return {
      ok: false,
      compile,
      message: result.spawnError
        ? `The ${spec.command} runtime could not be started: ${result.spawnError}`
        : `The ${spec.command} runtime is unavailable on this machine.`,
    }
  }
  if (result.status === 'timeout') {
    return { ok: false, compile, message: `Compilation exceeded ${LIMITS.compileTimeoutMs} ms and was stopped.` }
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      compile,
      message: result.stderr.trim() || `Compilation failed with exit code ${result.exitCode}.`,
    }
  }
  return { ok: true, compile }
}

function runSpec(language, dir, javaName, entryFile, python, projectMode) {
  if (language === 'python') {
    if (projectMode) {
      return {
        command: python,
        args: [
          '-I',
          '-B',
          '-c',
          "import runpy,sys;sys.path.insert(0,'.');runpy.run_path(sys.argv[1],run_name='__main__')",
          entryFile,
        ],
        note: 'No memory cap in this runner.',
      }
    }
    return { command: python, args: ['-I', '-B', entryFile], note: 'No memory cap in this runner.' }
  }
  if (language === 'javascript') {
    return {
      command: 'node',
      args: ['--no-warnings', '--max-old-space-size=256', entryFile],
      note: 'V8 heap capped at 256 MB.',
    }
  }
  if (language === 'typescript') {
    return {
      command: 'node',
      args: ['--no-warnings', '--max-old-space-size=256', entryFile],
      note: 'Node 24 native type stripping (no enums/namespaces). V8 heap capped at 256 MB.',
    }
  }
  if (language === 'c' || language === 'cpp') {
    return {
      command: join(dir, 'main.exe'),
      args: [],
      note: 'Native executable. No memory cap in this runner.',
    }
  }
  if (language === 'java') {
    return {
      command: 'java',
      args: ['-Xmx256m', '-XX:ActiveProcessorCount=1', '-cp', '.', javaName],
      note: 'JVM heap capped at 256 MB.',
    }
  }
  return null
}

/** Executes the prepared program once with the given stdin. */
async function runOnce(language, dir, javaName, entryFile, stdin, timeoutMs, jobId, projectMode) {
  const python = language === 'python' ? await resolvePythonExecutable() : 'python'
  const spec = runSpec(language, dir, javaName, entryFile, python, projectMode)
  if (!spec) {
    return {
      status: 'unsupported',
      stdout: '',
      stderr: '',
      exitCode: null,
      durationMs: 0,
      message: 'Unsupported language.',
      note: null,
    }
  }

  const result = await spawnProcess(spec.command, spec.args, {
    cwd: dir,
    env: baseEnv(dir),
    timeoutMs,
    stdin,
    jobId,
  })

  if (result.status === 'unsupported') {
    return {
      status: 'unsupported',
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: null,
      durationMs: result.durationMs,
      message: result.spawnError ?? `${spec.command} could not be started.`,
      note: spec.note,
    }
  }

  if (result.status === 'cancelled') {
    return {
      status: 'cancelled',
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: null,
      durationMs: result.durationMs,
      message: 'Execution was stopped by the user.',
      note: spec.note,
    }
  }

  if (result.status === 'timeout') {
    return {
      status: 'timeout',
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: null,
      durationMs: result.durationMs,
      message: `Execution exceeded the ${timeoutMs} ms limit and the process tree was stopped.`,
      note: spec.note,
    }
  }

  return {
    status: result.exitCode === 0 ? 'ok' : 'runtime_error',
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    message: result.exitCode === 0 ? null : `Process exited with code ${result.exitCode}.`,
    note: spec.note,
  }
}

function validateRequest(body) {
  if (!body || typeof body !== 'object') {
    return 'The request body must be a JSON object.'
  }
  const { language, code } = body
  if (typeof language !== 'string' || !LANGUAGE_IDS.includes(language)) {
    return `Language must be one of: ${LANGUAGE_IDS.join(', ')}.`
  }
  if (typeof code !== 'string' || code.trim().length === 0) {
    return 'No source code was provided.'
  }
  if (code.length > LIMITS.maxCodeChars) {
    return `Source code exceeds the ${LIMITS.maxCodeChars} character limit.`
  }
  const projectFilesError = validateProjectFiles(body)
  if (projectFilesError) {
    return projectFilesError
  }
  if (body.stdin !== undefined && typeof body.stdin !== 'string') {
    return 'stdin must be a string.'
  }
  if (typeof body.stdin === 'string' && body.stdin.length > LIMITS.maxStdinChars) {
    return `stdin exceeds the ${LIMITS.maxStdinChars} character limit.`
  }
  if (body.tests !== undefined) {
    if (!Array.isArray(body.tests) || body.tests.length === 0) {
      return 'tests must be a non-empty array.'
    }
    if (body.tests.length > LIMITS.maxTests) {
      return `At most ${LIMITS.maxTests} tests can run in one request.`
    }
    for (const test of body.tests) {
      if (!test || typeof test.stdin !== 'string') {
        return 'Each test needs a string stdin.'
      }
      if (test.stdin.length > LIMITS.maxStdinChars) {
        return `Test stdin exceeds the ${LIMITS.maxStdinChars} character limit.`
      }
    }
  }
  return null
}

function badRequest(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function timeoutFor(body) {
  return Math.min(Math.max(Number(body.timeoutMs) || 5_000, 500), LIMITS.runTimeoutMs)
}

export async function runCode(body) {
  const invalid = validateRequest(body)
  if (invalid) {
    throw badRequest(invalid)
  }

  const { language, code } = body
  const runtimes = await detectRuntimes()
  if (!runtimeReady(runtimes, language)) {
    return {
      language,
      status: 'unsupported',
      message: `The ${LANGUAGE_INFO[language].label} runtime is not available on this machine.`,
      compile: null,
      results: [],
    }
  }

  const tests = Array.isArray(body.tests) ? body.tests : [{ stdin: body.stdin ?? '' }]
  const timeoutMs = timeoutFor(body)
  const jobId = typeof body.jobId === 'string' ? body.jobId.slice(0, 80) : undefined
  const dir = await mkdtemp(join(tmpdir(), 'codepilot-exec-'))

  try {
    const env = baseEnv(dir)
    const { file, javaName } = await writeSource(
      language,
      code,
      dir,
      body.entryPath,
      body.projectFiles,
    )
    const compiled = await compileIfNeeded(language, dir, javaName, file, env, jobId)

    if (!compiled.ok) {
      return {
        language,
        status: 'compile_error',
        message: compiled.message ?? 'Compilation failed.',
        compile: compiled.compile,
        results: tests.map(() => ({
          status: 'compile_error',
          stdout: '',
          stderr: compiled.message ?? '',
          exitCode: null,
          durationMs: 0,
          message: compiled.message ?? 'Compilation failed.',
          note: null,
        })),
      }
    }

    const results = []
    for (const test of tests) {
      results.push(
        await runOnce(
          language,
          dir,
          javaName,
          file,
          test.stdin ?? '',
          timeoutMs,
          jobId,
          Boolean(body.projectFiles),
        ),
      )
    }

    const status = results.some((result) => result.status === 'cancelled')
      ? 'cancelled'
      : results.some((result) => result.status === 'timeout')
        ? 'timeout'
        : results.some((result) => result.status === 'runtime_error')
          ? 'runtime_error'
          : results.some((result) => result.status === 'unsupported')
            ? 'unsupported'
            : 'ok'

    return {
      language,
      status,
      message: null,
      compile: compiled.compile,
      durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
      results,
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function runProjectCode(body) {
  if (!body || typeof body !== 'object' || body.projectFiles === undefined) {
    throw badRequest('A bounded projectFiles snapshot is required.')
  }
  return runCode(body)
}

export async function traceCode(body) {
  if (!body || typeof body !== 'object' || typeof body.code !== 'string') {
    throw badRequest('A code string is required.')
  }
  if (body.language && body.language !== 'python') {
    return {
      status: 'unsupported',
      language: body.language,
      message:
        'Runtime tracing is implemented with real Python sys.settrace instrumentation only. This build will not display guessed variable values for other languages.',
      events: [],
      truncated: false,
      meta: null,
    }
  }
  if (body.code.trim().length === 0) {
    throw badRequest('No source code was provided.')
  }
  if (body.code.length > LIMITS.maxCodeChars) {
    throw badRequest(`Source code exceeds the ${LIMITS.maxCodeChars} character limit.`)
  }
  if (body.stdin !== undefined && typeof body.stdin !== 'string') {
    throw badRequest('stdin must be a string.')
  }
  if (typeof body.stdin === 'string' && body.stdin.length > LIMITS.maxStdinChars) {
    throw badRequest(`stdin exceeds the ${LIMITS.maxStdinChars} character limit.`)
  }

  const runtimes = await detectRuntimes()
  if (!runtimeReady(runtimes, 'python')) {
    return {
      status: 'unsupported',
      language: 'python',
      message: 'Python is not available on this machine, so no trace can be recorded.',
      events: [],
      truncated: false,
      meta: null,
    }
  }

  const dir = await mkdtemp(join(tmpdir(), 'codepilot-trace-'))
  const sourcePath = join(dir, 'user_program.py')
  const eventsPath = join(dir, 'events.json')
  const metaPath = join(dir, 'meta.json')

  try {
    await writeFile(sourcePath, body.code, 'utf8')
    const python = await resolvePythonExecutable()
    const result = await spawnProcess(
      python,
      ['-I', '-B', TRACE_HARNESS, sourcePath, eventsPath, metaPath, String(LIMITS.maxTraceEvents)],
      {
        cwd: dir,
        env: { ...baseEnv(dir), PYTHONPATH: '' },
        timeoutMs: timeoutFor(body),
        stdin: typeof body.stdin === 'string' ? body.stdin : '',
        jobId: typeof body.jobId === 'string' ? body.jobId.slice(0, 80) : undefined,
      },
    )

    let events = []
    let truncated = false
    let meta = null
    try {
      const raw = JSON.parse(await readFile(eventsPath, 'utf8'))
      events = Array.isArray(raw.events) ? raw.events : []
      truncated = raw.truncated === true
    } catch {
      // No trace file means the harness itself failed before recording.
    }
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf8'))
    } catch {
      meta = null
    }

    const harnessFailed = result.status === 'unsupported' || (events.length === 0 && !meta)
    const timedOut = result.status === 'timeout'
    const cancelled = result.status === 'cancelled'

    return {
      language: 'python',
      status: harnessFailed ? 'error' : cancelled ? 'cancelled' : timedOut ? 'timeout' : 'ok',
      message: harnessFailed
        ? clip(result.stderr.trim() || result.spawnError || 'The trace harness did not start.', 2_000)
        : cancelled
          ? 'Tracing was stopped by the user.'
          : timedOut
            ? 'The program exceeded the trace time limit and the process tree was stopped.'
            : null,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      events,
      truncated,
      meta,
      instrumentation: 'Python sys.settrace · real runtime events',
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

export function normalizeOutput(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim()
}

/**
 * Grades against the full suite held in problems.mjs. Only indices, visibility,
 * status and bounded stderr leave the service — hidden inputs and expected
 * outputs never cross the network boundary.
 */
export async function gradeSubmission(body, problemSets) {
  const invalid = validateRequest(body)
  if (invalid) {
    throw badRequest(invalid)
  }

  const { problemId, language, code } = body
  if (typeof problemId !== 'string' || !problemSets[problemId]) {
    throw badRequest('Unknown problem id.', 404)
  }

  const suite = problemSets[problemId]
  if (!suite.supported.includes(language)) {
    return {
      verdict: 'unsupported_language',
      passed: 0,
      total: suite.tests.length,
      message: `${LANGUAGE_INFO[language].label} is not configured for this problem.`,
      cases: [],
    }
  }

  const runtimes = await detectRuntimes()
  if (!runtimeReady(runtimes, language)) {
    return {
      verdict: 'unsupported_language',
      passed: 0,
      total: suite.tests.length,
      message: `The ${LANGUAGE_INFO[language].label} runtime is not available on this machine.`,
      cases: [],
    }
  }

  const timeoutMs = timeoutFor(body)
  const jobId = typeof body.jobId === 'string' ? body.jobId.slice(0, 80) : undefined
  const dir = await mkdtemp(join(tmpdir(), 'codepilot-grade-'))

  try {
    const env = baseEnv(dir)
    const { javaName } = await writeSource(language, code, dir)
    const compiled = await compileIfNeeded(language, dir, javaName, env, jobId)

    if (!compiled.ok) {
      return {
        verdict: 'compile_error',
        passed: 0,
        total: suite.tests.length,
        message: compiled.message ?? 'Compilation failed.',
        compile: compiled.compile,
        cases: suite.tests.map((test, index) => ({
          index,
          hidden: test.hidden === true,
          status: 'compile_error',
          durationMs: 0,
          stderr: '',
        })),
      }
    }

    const cases = []
    let passed = 0
    let sawTimeout = false
    let sawRuntimeError = false
    let sawCancelled = false

    for (let index = 0; index < suite.tests.length; index += 1) {
      const test = suite.tests[index]
      const result = await runOnce(language, dir, javaName, test.stdin, timeoutMs, jobId)
      let status = result.status
      if (status === 'ok') {
        status =
          normalizeOutput(result.stdout) === normalizeOutput(test.expected)
            ? 'passed'
            : 'wrong_answer'
      }
      if (status === 'passed') {
        passed += 1
      }
      if (status === 'timeout') {
        sawTimeout = true
      }
      if (status === 'runtime_error') {
        sawRuntimeError = true
      }
      if (status === 'cancelled') {
        sawCancelled = true
      }
      cases.push({
        index,
        hidden: test.hidden === true,
        status,
        durationMs: result.durationMs,
        // Hidden cases reveal stderr only (never input or expected output), and
        // even that is bounded so it cannot be used as an oracle.
        stderr: test.hidden === true ? '' : clip(result.stderr, 1_200),
      })
    }

    const verdict = sawCancelled
      ? 'cancelled'
      : passed === suite.tests.length
        ? 'accepted'
        : sawTimeout
          ? 'time_limit_exceeded'
          : sawRuntimeError
            ? 'runtime_error'
            : 'wrong_answer'

    return {
      verdict,
      passed,
      total: suite.tests.length,
      message: null,
      compile: compiled.compile,
      cases,
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
