#!/usr/bin/env python3
"""Bounded descriptor-relative config read; stdout is a private pipe to Node.

No file content is placed in arguments, exceptions or logs. Reuse the
repository's existing no-follow directory primitives; no package is installed.
"""
import base64
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys


def main():
    handles = []
    try:
        location = Path(__file__).resolve().parent.parent / "worktree-control" / "secure-file-ops.py"
        spec = importlib.util.spec_from_file_location("sandbox_secure_paths", location)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        if not helper.capability_check():
            raise ValueError("capability unavailable")
        request = json.load(sys.stdin)
        root = helper.open_absolute_directory(request["root"])
        handles.append(root)
        parent, name = helper.open_parent(root, helper.path_segments(request["relative"]), False)
        handles.append(parent)
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        handles.append(fd)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("not a regular file")
        chunks = []
        total = 0
        while True:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            total += len(chunk)
            if total > 1024 * 1024:
                raise ValueError("oversized config")
            chunks.append(chunk)
        print(json.dumps({"ok": True, "bytes": base64.b64encode(b"".join(chunks)).decode("ascii")}))
    except Exception:
        print(json.dumps({"ok": False}))
    finally:
        for fd in reversed(handles):
            os.close(fd)


if __name__ == "__main__":
    main()
