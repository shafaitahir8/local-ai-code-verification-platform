from pathlib import Path

Path("SETUP_PY_WAS_EXECUTED").write_text("profiling executed repository code", encoding="utf-8")
raise RuntimeError("project profiling must never execute setup.py")
