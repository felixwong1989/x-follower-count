"""Create a runtime-only extension ZIP, with manifest.json at its root."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    "manifest.json", "network-core.js", "network.js",
    "core.js", "content.js", "style.css",
)

def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    for name in FILES:
        if not (ROOT / name).is_file():
            raise FileNotFoundError(name)
    destination = ROOT / "dist"
    destination.mkdir(exist_ok=True)
    output = destination / f"x-follower-count-v{manifest['version']}.zip"
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(ROOT / name, arcname=name)
    with ZipFile(output) as archive:
        assert "manifest.json" in archive.namelist()
        assert archive.testzip() is None
    print(output)

if __name__ == "__main__":
    main()
