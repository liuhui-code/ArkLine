#!/usr/bin/env bash
set -euo pipefail

readonly apt_options=(
  -o Acquire::Retries=3
  -o Acquire::http::Timeout=30
  -o Dpkg::Lock::Timeout=60
  -o Dpkg::Use-Pty=0
)
readonly packages=(
  libwebkit2gtk-4.1-dev
  libayatana-appindicator3-dev
  librsvg2-dev
  patchelf
  xdg-utils
)

run_apt() {
  local operation="$1"
  shift

  local attempt
  for attempt in 1 2; do
    if sudo env DEBIAN_FRONTEND=noninteractive timeout --signal=TERM 4m \
      apt-get "${apt_options[@]}" "$operation" "$@"; then
      return 0
    fi

    if [[ "$attempt" -eq 2 ]]; then
      echo "apt-get $operation failed after $attempt bounded attempts" >&2
      return 1
    fi

    echo "apt-get $operation attempt $attempt failed; retrying in 10 seconds" >&2
    sleep 10
  done
}

run_apt update
run_apt install -y --no-install-recommends "${packages[@]}"
