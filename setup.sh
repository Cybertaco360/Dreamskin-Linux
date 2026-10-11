#!/bin/sh
# Install the DreamSkin Linux command and menu entries for the current user.
set -eu

setup_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

if [ -x /usr/bin/python3 ]; then
    setup_python=/usr/bin/python3
elif command -v python3 >/dev/null 2>&1; then
    setup_python=$(command -v python3)
else
    printf '%s\n' 'Python 3 is required. Install it with your distribution package manager; see DISTROS.md.' >&2
    exit 1
fi

exec "$setup_python" "$setup_directory/install.py" "$@"
