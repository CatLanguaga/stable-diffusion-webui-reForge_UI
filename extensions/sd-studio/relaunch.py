"""
sd-studio relauncher: restarts reForge after the old server process has fully exited.

Why: hot-swapping SDXL checkpoints in reForge leaks the previous model's RAM (~12 GB)
and often segfaults while loading the next text encoder. A fresh process avoids that.

Spawned (detached) by scripts/studio.py -> POST /studio/api/switch-checkpoint.
Usage: python relaunch.py <job.json>
  job.json = {"pid": old server pid, "host": "127.0.0.1", "port": 7860,
              "cwd": reForge root, "python": interpreter, "argv": [launch args], "log": log path}

Steps: wait until the old pid is gone and the port stops answering (max ~90 s),
then start `python -u launch.py <argv>` detached, with stdout/stderr appended to `log`.
"""

import json
import os
import socket
import subprocess
import sys
import time


def _port_open(host: str, port: int) -> bool:
    """True if something still accepts TCP connections on host:port."""
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def _pid_alive(pid: int) -> bool:
    """True if the process exists. Uses psutil (bundled with reForge's venv) when available."""
    try:
        import psutil
        return psutil.pid_exists(pid)
    except ImportError:
        return False  # fall back to the port check only


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        job = json.load(f)

    deadline = time.time() + 90
    while time.time() < deadline and (_pid_alive(job["pid"]) or _port_open(job["host"], job["port"])):
        time.sleep(0.5)
    # Let the OS/driver release the socket and GPU memory. 1 s was not enough after killing a
    # hung CUDA process: the new server crashed (0xc0000005 in torch_cpu.dll) loading the text encoder.
    time.sleep(5)

    env = dict(os.environ)
    env["COMMANDLINE_ARGS"] = ""  # args are already expanded into job["argv"]; avoid duplicating them

    flags = 0
    if os.name == "nt":
        # no console window, survives the parent (Claude session / old server) exiting
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW

    with open(job["log"], "a", encoding="utf-8", errors="replace") as log:
        log.write(f"\n===== sd-studio relaunch {time.strftime('%Y-%m-%d %H:%M:%S')} =====\n")
        log.flush()
        subprocess.Popen(
            [job["python"], "-u", "launch.py", *job["argv"]],
            cwd=job["cwd"], env=env, stdout=log, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, creationflags=flags, close_fds=True,
        )


if __name__ == "__main__":
    main()
