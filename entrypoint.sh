#!/bin/sh
set -e

# Fix ownership of volume-mounted directories (created as root by Docker)
chown -R mindbridge:mindbridge /home/mindbridge/.claude /data 2>/dev/null || true

# Give mindbridge access to Docker socket
if [ -S /var/run/docker.sock ]; then
  DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
  if ! getent group "$DOCKER_GID" >/dev/null 2>&1; then
    groupadd -g "$DOCKER_GID" dockerhost
  fi
  DOCKER_GROUP=$(getent group "$DOCKER_GID" | cut -d: -f1)
  usermod -aG "$DOCKER_GROUP" mindbridge
fi

# Restore .claude.json if missing (Claude CLI deletes it on occasion, keeps backups)
if [ ! -f /home/mindbridge/.claude.json ]; then
  BACKUP=$(ls -t /home/mindbridge/.claude/backups/.claude.json.backup.* 2>/dev/null | head -1)
  if [ -n "$BACKUP" ]; then
    cp "$BACKUP" /home/mindbridge/.claude.json
    chown mindbridge:mindbridge /home/mindbridge/.claude.json
  fi
fi

exec gosu mindbridge node dist/index.js
