"""Read-only Markdown size and exact-duplication audit. No network or model calls."""

import argparse
import hashlib
import json
import os
from pathlib import Path


EXCLUDED_DIRS = {
    ".git", ".env", "node_modules", ".venv", "venv", "dist", "build",
    "__pycache__", "secrets", "credentials",
}
SENSITIVE_NAMES = ("secret", "credential", "password", "private-key", ".env")


def audit(repo, roots, limit=12):
    repo = Path(repo).resolve(strict=True)
    records = []
    warnings = []
    seen = set()
    for root in roots:
        relative = Path(root)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Roots must be relative paths inside the repository")
        if any(part in EXCLUDED_DIRS for part in relative.parts):
            raise ValueError("Excluded directory requested")
        start = repo / relative
        if start.is_symlink():
            warnings.append({"root": str(relative), "reason": "symlink_skipped"})
            continue
        resolved = start.resolve()
        if not resolved.is_relative_to(repo):
            raise ValueError("Root escapes the repository")
        if not start.is_dir():
            warnings.append({"root": str(relative), "reason": "not_a_directory"})
            continue
        for folder, dirs, names in os.walk(start, followlinks=False):
            dirs[:] = sorted(
                d for d in dirs
                if d not in EXCLUDED_DIRS and not (Path(folder) / d).is_symlink()
            )
            for name in sorted(names):
                file = Path(folder) / name
                if file.suffix.lower() != ".md" or file.is_symlink():
                    continue
                if any(s in name.lower() for s in SENSITIVE_NAMES):
                    continue
                key = file.resolve()
                if key in seen:
                    continue
                seen.add(key)
                try:
                    payload = file.read_bytes()
                except OSError as exc:
                    warnings.append({
                        "path": file.relative_to(repo).as_posix(),
                        "reason": type(exc).__name__,
                    })
                    continue
                records.append({
                    "path": file.relative_to(repo).as_posix(),
                    "bytes": len(payload),
                    "lines": len(payload.splitlines()),
                    "sha256": hashlib.sha256(payload).hexdigest(),
                })
    groups = {}
    for record in records:
        groups.setdefault(record["sha256"], []).append(record["path"])
    duplicate_groups = sorted(
        [sorted(paths) for paths in groups.values() if len(paths) > 1],
        key=lambda group: group[0],
    )
    records.sort(key=lambda record: (-record["bytes"], record["path"]))
    return {
        "scope": list(roots),
        "readOnly": True,
        "tokenCountMeasured": False,
        "markdownFiles": len(records),
        "totalBytes": sum(record["bytes"] for record in records),
        "totalLines": sum(record["lines"] for record in records),
        "largest": [
            {k: row[k] for k in ("path", "bytes", "lines")}
            for row in records[:limit]
        ],
        "exactDuplicateGroups": duplicate_groups[:limit],
        "exactDuplicateGroupsTotal": len(duplicate_groups),
        "warnings": warnings,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--roots", nargs="+", default=["memoria", "docs"])
    parser.add_argument("--limit", type=int, default=12)
    args = parser.parse_args()
    if not 1 <= args.limit <= 100:
        parser.error("--limit must be between 1 and 100")
    try:
        report = audit(args.repo, args.roots, args.limit)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
