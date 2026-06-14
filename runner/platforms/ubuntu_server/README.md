# Ubuntu Server Runner

This directory is reserved for the future headless Ubuntu server host.

The intended host model is a systemd service that starts the shared `taskhub_runner` core and writes process logs to journald/stdout. No GUI behavior belongs in this platform directory.
