#!/usr/bin/env python3
"""Read bounded regular files through held no-follow directory descriptors."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys


def identity(st):
    return [str(st.st_dev), str(st.st_ino), str(st.st_size),
            str(st.st_mtime_ns), str(st.st_ctime_ns), st.st_mode, st.st_nlink]


def remove_tree(parent, name):
    """Unlink only below held descriptors, never traverse substituted links."""
    try:
        observed = os.stat(name, dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        return
    if not stat.S_ISDIR(observed.st_mode):
        os.unlink(name, dir_fd=parent)
        return
    child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        if (observed.st_dev, observed.st_ino) != (os.fstat(child).st_dev, os.fstat(child).st_ino):
            raise ValueError()
        for entry in os.listdir(child):
            remove_tree(child, entry)
        current = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if (observed.st_dev, observed.st_ino) != (current.st_dev, current.st_ino):
            raise ValueError()
        os.rmdir(name, dir_fd=parent)
    finally:
        os.close(child)


def main():
    handles = []
    try:
        location = Path(__file__).resolve().parent.parent / "worktree-control" / "secure-file-ops.py"
        spec = importlib.util.spec_from_file_location("sandbox_secure_paths", location)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        if not helper.capability_check():
            raise ValueError()
        request = json.load(sys.stdin)
        if request.get("action") in ("stage", "discard"):
            try:
                root = helper.open_absolute_directory(request["root"])
            except FileNotFoundError:
                if request["action"] != "discard":
                    raise
                print(json.dumps({"ok": True}))
                return
            handles.append(root)
            name = request["name"]
            if len(helper.path_segments(name)) != 1:
                raise ValueError()
            if request["action"] == "discard":
                remove_tree(root, name)
                print(json.dumps({"ok": True}))
                return
            os.mkdir(name, 0o700, dir_fd=root)
            destination = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root)
            handles.append(destination)
            for file in request["files"]:
                parent, leaf = helper.open_parent(destination, helper.path_segments(file["path"]), True)
                try:
                    fd = os.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, file["mode"] & 0o777, dir_fd=parent)
                    try:
                        data = base64.b64decode(file["bytes"], validate=True)
                        while data:
                            written = os.write(fd, data)
                            data = data[written:]
                        os.fchmod(fd, file["mode"] & 0o777)
                    finally:
                        os.close(fd)
                finally:
                    os.close(parent)
            print(json.dumps({"ok": True}))
            return
        paths, limits = request["paths"], request["limits"]
        if not paths or len(paths) > min(limits["count"], 256):
            raise ValueError()
        root = helper.open_absolute_directory(request["root"])
        handles.append(root)
        files, total = [], 0
        for path in paths:
            segments = helper.path_segments(path)
            parent = os.dup(root)
            local = [parent]
            try:
                ancestors = [[str(os.fstat(parent).st_dev), str(os.fstat(parent).st_ino)]]
                for segment in segments[:-1]:
                    parent = os.open(segment, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
                    local.append(parent)
                    ancestors.append([str(os.fstat(parent).st_dev), str(os.fstat(parent).st_ino)])
                fd = os.open(segments[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
                local.append(fd)
                before = os.fstat(fd)
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > min(limits["fileBytes"], 2097152):
                    raise ValueError()
                chunks, size = [], 0
                while True:
                    chunk = os.read(fd, 65536)
                    if not chunk:
                        break
                    size += len(chunk)
                    total += len(chunk)
                    if size > min(limits["fileBytes"], 2097152) or total > min(limits["totalBytes"], 16777216):
                        raise ValueError()
                    chunks.append(chunk)
                if identity(before) != identity(os.fstat(fd)) or identity(before) != identity(os.stat(segments[-1], dir_fd=parent, follow_symlinks=False)):
                    raise ValueError()
                files.append({"path": path, "bytes": base64.b64encode(b"".join(chunks)).decode("ascii"),
                              "identity": identity(before), "ancestors": ancestors,
                              "mode": stat.S_IMODE(before.st_mode), "size": size})
            finally:
                for fd in reversed(local):
                    os.close(fd)
        print(json.dumps({"ok": True, "files": files}))
    except Exception:
        print(json.dumps({"ok": False}))
    finally:
        for fd in reversed(handles):
            os.close(fd)


if __name__ == "__main__":
    main()
