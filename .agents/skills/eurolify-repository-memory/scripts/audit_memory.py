"""Read-only Markdown size and exact-duplication audit. No network or model calls."""

import argparse
import hashlib
import json
import os
import re
from pathlib import Path


EXCLUDED_DIRS = {
    ".git", ".env", "node_modules", ".venv", "venv", "dist", "build",
    "__pycache__", "secrets", "credentials",
}
# Compara palavras inteiras do nome (separadas por «-», «_», «.» ou espaço),
# não pedaços de texto: «desenhado» não é «senha», «secretaria» não é
# «secret», e «chave» ou «token» sozinhos (ADR-0029 «chave-do-age…»,
# «design-token.md») não são segredos. Só contam as palavras e as sequências
# abaixo, com qualquer separador (`api_key`, `api-key`) ou nenhum (`apikey`).
SENSITIVE_WORDS = {
    "secret", "secrets", "segredo", "segredos", "credential", "credentials",
    "credencial", "credenciais", "password", "passwords", "senha", "senhas",
    "env",
}
SENSITIVE_SEQUENCES = (
    ("palavra", "passe"), ("palavras", "passe"),
    ("private", "key"), ("chave", "privada"), ("chave", "secreta"),
    ("chave", "api"), ("chave", "de", "api"), ("api", "key"),
    ("api", "token"), ("access", "token"), ("token", "de", "acesso"),
)


def sensitive_name(name):
    """Diz se o nome do ficheiro sugere um segredo (palavras inteiras)."""
    words = [w for w in re.split(r"[-_. ]+", name.lower()) if w]
    if words and words[-1] == "md":
        words = words[:-1]
    if any(w in SENSITIVE_WORDS for w in words):
        return True
    for seq in SENSITIVE_SEQUENCES:
        n = len(seq)
        if any(tuple(words[i:i + n]) == seq for i in range(len(words) - n + 1)):
            return True
        if "".join(seq) in words:
            return True
    return False


NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)


def read_no_follow(file):
    """Lê o ficheiro sem seguir uma ligação posta a meio (O_NOFOLLOW onde existe)."""
    fd = os.open(file, os.O_RDONLY | NOFOLLOW)
    with os.fdopen(fd, "rb") as handle:
        return handle.read()


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
                if sensitive_name(name):
                    warnings.append({
                        "path": file.relative_to(repo).as_posix(),
                        "reason": "sensitive_name_skipped",
                    })
                    continue
                key = file.resolve()
                if key in seen:
                    continue
                seen.add(key)
                try:
                    payload = read_no_follow(file)
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
