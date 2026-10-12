# The Linux build environment: what the release workflow's Linux job installs
# on ubuntu-22.04 (its glibc is what the AppImage needs at least, so the
# app runs on 2022-and-later distros). Used by scripts/build-linux.sh.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl wget file git pkg-config xdg-utils \
      libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev \
      libxdo-dev libssl-dev patchelf \
    && rm -rf /var/lib/apt/lists/*

# Rust (stable, as CI) and Node 22 with pnpm 10 (as CI).
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable -c clippy
ENV PATH=/root/.cargo/bin:$PATH
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable && corepack prepare pnpm@10 --activate

# linuxdeploy (which the AppImage bundler runs) is itself an AppImage, and a
# container has no FUSE: unpack it instead of mounting it.
ENV APPIMAGE_EXTRACT_AND_RUN=1
