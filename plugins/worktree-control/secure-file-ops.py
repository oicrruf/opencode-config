#!/usr/bin/env python3
"""Descriptor-relative file operations for worktree credential materialization.

This helper uses only Python's standard library. It fails closed when the host
does not expose the directory-descriptor and no-follow primitives it needs.
Input/output are JSON metadata only; file contents never cross the process
boundary and are never printed.
"""

import json
import os
import secrets
import stat
import sys


def respond(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")


def fail(reason):
    respond({"ok": False, "reason": reason})
    return 0


def capability_check():
    required = (os.open, os.mkdir, os.unlink, os.stat, os.link)
    if not all(function in os.supports_dir_fd for function in required):
        return False
    if os.stat not in os.supports_follow_symlinks or os.link not in os.supports_follow_symlinks:
        return False
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        return False
    return True


def open_absolute_directory(path):
    if not isinstance(path, str) or not os.path.isabs(path):
        raise ValueError("invalid root")
    current = os.open(os.path.sep, os.O_RDONLY | os.O_DIRECTORY)
    try:
        for segment in path.split(os.path.sep):
            if not segment:
                continue
            if segment in (".", ".."):
                raise ValueError("invalid root")
            child = os.open(
                segment,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=current,
            )
            os.close(current)
            current = child
        return current
    except Exception:
        os.close(current)
        raise


def path_segments(path):
    if not isinstance(path, str) or not path or path.startswith(("/", "\\")):
        raise ValueError("invalid relative path")
    segments = path.replace("\\", "/").split("/")
    if any(not item or item in (".", "..") for item in segments):
        raise ValueError("invalid relative path")
    return segments


def open_parent(root_fd, segments, create):
    current = os.dup(root_fd)
    try:
        for segment in segments[:-1]:
            try:
                child = os.open(
                    segment,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=current,
                )
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(segment, 0o700, dir_fd=current)
                child = os.open(
                    segment,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=current,
                )
            os.close(current)
            current = child
        return current, segments[-1]
    except Exception:
        os.close(current)
        raise


def copy_file(data):
    source_root = open_absolute_directory(data["sourceRoot"])
    destination_root = open_absolute_directory(data["destinationRoot"])
    source_segments = path_segments(data["sourceRelative"])
    destination_segments = path_segments(data["destinationRelative"])
    source_parent, source_name = open_parent(source_root, source_segments, False)
    destination_parent = None
    source_fd = None
    destination_fd = None
    temporary_name = None
    temporary_created = False
    destination_created = False
    try:
        source_fd = os.open(source_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=source_parent)
        if not stat.S_ISREG(os.fstat(source_fd).st_mode):
            raise ValueError("source is not a regular file")
        destination_parent, destination_name = open_parent(destination_root, destination_segments, True)
        temporary_name = ".opencode-mcp-" + secrets.token_hex(16) + ".tmp"
        destination_fd = os.open(
            temporary_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=destination_parent,
        )
        temporary_created = True
        while True:
            chunk = os.read(source_fd, 1024 * 1024)
            if not chunk:
                break
            view = memoryview(chunk)
            while view:
                written = os.write(destination_fd, view)
                view = view[written:]
        os.fchmod(destination_fd, 0o600)
        os.fsync(destination_fd)
        # Publish only a complete file, without replacing a path created by
        # another process. The hard link is atomic and remains on one fs.
        os.link(
            temporary_name,
            destination_name,
            src_dir_fd=destination_parent,
            dst_dir_fd=destination_parent,
            follow_symlinks=False,
        )
        destination_created = True
        os.unlink(temporary_name, dir_fd=destination_parent)
        temporary_created = False
        os.fsync(destination_parent)
        info = os.fstat(destination_fd)
        respond({
            "ok": True,
            "identity": [str(info.st_dev), str(info.st_ino), str(info.st_size), str(info.st_mtime_ns)],
            "mode": 384,
        })
        return 0
    except Exception:
        if destination_created and destination_parent is not None:
            try:
                os.unlink(destination_name, dir_fd=destination_parent)
            except Exception:
                pass
        if temporary_created and destination_parent is not None and temporary_name is not None:
            try:
                os.unlink(temporary_name, dir_fd=destination_parent)
            except Exception:
                pass
        raise
    finally:
        for descriptor in (destination_fd, source_fd, destination_parent, source_parent, destination_root, source_root):
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    pass


def inspect_file(data):
    root_fd = open_absolute_directory(data["root"])
    segments = path_segments(data["relative"])
    parent_fd = None
    file_fd = None
    try:
        try:
            parent_fd, name = open_parent(root_fd, segments, False)
        except FileNotFoundError:
            respond({"ok": True, "state": "missing"})
            return 0
        try:
            file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        except FileNotFoundError:
            respond({"ok": True, "state": "missing"})
            return 0
        info = os.fstat(file_fd)
        if not stat.S_ISREG(info.st_mode):
            respond({"ok": False, "reason": "target is not a regular file"})
            return 0
        respond({
            "ok": True,
            "state": "present",
            "mode": stat.S_IMODE(info.st_mode),
            "identity": [str(info.st_dev), str(info.st_ino), str(info.st_size), str(info.st_mtime_ns)],
        })
        return 0
    finally:
        for descriptor in (file_fd, parent_fd, root_fd):
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    pass


def remove_file(data):
    root_fd = open_absolute_directory(data["root"])
    segments = path_segments(data["relative"])
    parent_fd = None
    file_fd = None
    try:
        parent_fd, name = open_parent(root_fd, segments, False)
        file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        info = os.fstat(file_fd)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("target is not a regular file")
        expected = data.get("identity")
        actual = [str(info.st_dev), str(info.st_ino), str(info.st_size), str(info.st_mtime_ns)]
        if expected != actual:
            raise ValueError("target no longer matches owned identity")
        current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        if tuple(map(str, (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns))) != tuple(actual):
            raise ValueError("target changed during validation")
        os.unlink(name, dir_fd=parent_fd)
        respond({"ok": True, "removed": True})
        return 0
    finally:
        for descriptor in (file_fd, parent_fd, root_fd):
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    pass


def main():
    if not capability_check():
        return fail("required secure filesystem capabilities are unavailable")
    try:
        data = json.load(sys.stdin)
        operation = data.get("operation")
        if operation == "copy":
            return copy_file(data)
        if operation == "inspect":
            return inspect_file(data)
        if operation == "remove":
            return remove_file(data)
        return fail("unsupported secure file operation")
    except Exception:
        return fail("secure filesystem operation failed")


if __name__ == "__main__":
    raise SystemExit(main())
