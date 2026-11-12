"""Real Python execution tracer for CodePilot Lab.

Records actual interpreter events through sys.settrace. Nothing is guessed:
every variable value is a snapshot of frame.f_locals at that event, bounded
and stringified with reprlib. The trace is capped; when the cap is reached
tracing stops (the program keeps running) and the payload is marked truncated.

Usage:
  python trace_python.py <source> <events.json> <meta.json> <max_events>
"""

import json
import os
import reprlib
import sys

source_path = os.path.abspath(sys.argv[1])
events_path = sys.argv[2]
meta_path = sys.argv[3]
max_events = int(sys.argv[4]) if len(sys.argv) > 4 else 2500

with open(source_path, "r", encoding="utf-8") as handle:
    source = handle.read()

try:
    code = compile(source, source_path, "exec")
except SyntaxError as exc:
    meta = {
        "ok": False,
        "error": f"{exc.__class__.__name__}: {exc.msg} (line {exc.lineno})",
        "events": 0,
        "truncated": False,
        "python": sys.version.split()[0],
    }
    with open(meta_path, "w", encoding="utf-8") as handle:
        json.dump(meta, handle)
    with open(events_path, "w", encoding="utf-8") as handle:
        json.dump({"events": [], "truncated": False}, handle)
    print(f"{exc.__class__.__name__}: {exc.msg} (line {exc.lineno})", file=sys.stderr)
    sys.exit(1)

events = []
truncated = False
frame_ids = {}
next_frame_id = [0]
seen = {}
output_buffer = [""]
finished = [False]
real_stdout = sys.stdout
real_stderr = sys.stderr

renderer = reprlib.Repr()
renderer.maxstring = 240
renderer.maxother = 140
renderer.maxlist = 24
renderer.maxdict = 16
renderer.maxlevel = 3
renderer.maxlong = 48
renderer.maxset = 16


def safe_repr(value):
    try:
        return renderer.repr(value)
    except Exception:
        return "<unrepresentable value>"


class Tee:
    def __init__(self, stream):
        self.stream = stream

    def write(self, text):
        try:
            output_buffer[0] += text
        except Exception:
            pass
        try:
            self.stream.write(text)
        except Exception:
            pass
        return len(text)

    def flush(self):
        try:
            self.stream.flush()
        except Exception:
            pass


def function_name(frame):
    name = frame.f_code.co_name
    return "<module>" if name == "<module>" else name


def stack_snapshot(frame):
    stack = []
    cursor = frame
    while cursor is not None and len(stack) < 40:
        if cursor.f_code.co_filename == source_path:
            stack.append(
                {
                    "function": function_name(cursor),
                    "line": cursor.f_lineno,
                }
            )
        cursor = cursor.f_back
    return stack


def variable_snapshot(frame):
    frame_id = frame_ids.get(frame)
    if frame_id is None:
        return []
    table = seen.setdefault(frame_id, {})
    variables = []
    try:
        items = list(frame.f_locals.items())
    except Exception:
        return []

    for name, value in items[:60]:
        if name.startswith("__") and name.endswith("__"):
            continue
        type_name = type(value).__name__
        text = safe_repr(value)
        prior = table.get(name)
        line = frame.f_lineno

        if prior is None:
            table[name] = {
                "value": text,
                "type": type_name,
                "declaredAt": line,
                "changedAt": line,
            }
            variables.append(
                {
                    "name": name,
                    "type": type_name,
                    "value": text,
                    "previousValue": None,
                    "changed": True,
                    "scope": function_name(frame),
                    "declaredAt": line,
                    "changedAt": line,
                    "frameId": frame_id,
                }
            )
            continue

        changed = prior["value"] != text or prior["type"] != type_name
        previous = prior["value"]
        if changed:
            prior["value"] = text
            prior["type"] = type_name
            prior["changedAt"] = line

        variables.append(
            {
                "name": name,
                "type": type_name,
                "value": text,
                "previousValue": previous if changed else None,
                "changed": changed,
                "scope": function_name(frame),
                "declaredAt": prior["declaredAt"],
                "changedAt": prior["changedAt"],
                "frameId": frame_id,
            }
        )
    return variables


def record(event, frame, arg):
    global truncated

    if len(events) >= max_events:
        if not truncated:
            truncated = True
            sys.settrace(None)
        return

    output = output_buffer[0]
    output_buffer[0] = ""

    payload = {
        "index": len(events),
        "event": event,
        "line": frame.f_lineno,
        "function": function_name(frame),
        "stack": stack_snapshot(frame),
        "variables": variable_snapshot(frame),
        "output": output,
    }

    if event == "return":
        payload["returnValue"] = safe_repr(arg)
    if event == "exception":
        exc_type, exc_value = arg[0], arg[1]
        payload["exception"] = f"{exc_type.__name__}: {exc_value}"
        payload["variables"] = variable_snapshot(frame)

    events.append(payload)


def local_trace(frame, event, arg):
    if frame.f_code.co_filename != source_path:
        return None
    record(event, frame, arg)
    return local_trace


def global_trace(frame, event, arg):
    if frame.f_code.co_filename != source_path:
        return None

    if event == "call":
        if len(events) >= max_events:
            record(event, frame, arg)
            return None
        frame_id = next_frame_id[0]
        next_frame_id[0] += 1
        frame_ids[frame] = frame_id
        seen.setdefault(frame_id, {})
        record("call", frame, arg)

    return local_trace


status = "ok"
error = None
meta = {}

sys.stdout = Tee(real_stdout)
sys.settrace(global_trace)
sys.stdin = sys.stdin

try:
    exec(code, {"__name__": "__main__", "__file__": source_path, "__builtins__": __builtins__})
except SystemExit as exc:
    if exc.code not in (None, 0):
        status = "error"
        error = f"SystemExit: {exc.code}"
except BaseException as exc:
    status = "error"
    error = f"{exc.__class__.__name__}: {exc}"
    import traceback

    traceback.print_exc(file=real_stderr)
finally:
    sys.settrace(None)
    sys.stdout = real_stdout
    finished[0] = True

    meta = {
        "ok": status == "ok",
        "error": error,
        "events": len(events),
        "truncated": truncated,
        "python": sys.version.split()[0],
        "sourcePath": source_path,
        "finalOutput": output_buffer[0],
    }

    try:
        with open(events_path, "w", encoding="utf-8") as handle:
            json.dump({"events": events, "truncated": truncated}, handle)
    except Exception as exc:
        print(f"trace write failed: {exc}", file=real_stderr)

    try:
        with open(meta_path, "w", encoding="utf-8") as handle:
            json.dump(meta, handle)
    except Exception as exc:
        print(f"meta write failed: {exc}", file=real_stderr)

if status != "ok":
    sys.exit(1)
