#!/usr/bin/env python3
"""Builds test variants of the app under out/variants/ (distinct appIds, so they can sit on the watch
side by side). Each variant is a list of text substitutions on files of app/. Needs node on PATH.
Usage: tools/build_variants.py [a b c]"""
import json, pathlib, shutil, subprocess, sys, time
ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOL = ROOT / "editor/extension/node_modules/@suunto-internal/suuntoplus-tools/bin/build-app.js"
LE128 = "0xFB,0x34,0x9B,0x5F,0x80,0x00,0x00,0x80,0x00,0x10,0x00,0x00"   # base UUID tail, little-endian
BE128 = "0x00,0x00,{hi},{lo},0x00,0x00,0x10,0x00,0x80,0x00,0x00,0x80,0x5F,0x9B,0x34,0xFB"

def uuid_files(form):
    """ext2/3/4 with the UUIDs spelled as `form`: 'le16', 'be128'."""
    def arr(u):
        hi, lo = u >> 8, u & 255
        if form == "le16":
            return f"[0x{lo:02X},0x{hi:02X}]"
        return "[" + BE128.format(hi=f"0x{hi:02X}", lo=f"0x{lo:02X}") + "]"
    def f(cid, ch):
        return (f"function(conn) {{\n  appConn.regUuid(conn, {cid},\n    {arr(0xFFE0)},\n    {arr(ch)}\n  );\n}}\n")
    return {"ext2.js": f(0, 0xFFD1), "ext3.js": f(1, 0xFFE2), "ext4.js": f(2, 0xFFE1)}

VARIANTS = {
    "a": ("16-bit UUID arrays",          {**uuid_files("le16")}, []),
    "b": ("128-bit UUIDs big-endian",    {**uuid_files("be128")}, []),
    "c": ("8 s wait after connect",      {}, [("main.js", "var GAP = 0,", "var GAP = 8,")]),
}
only = sys.argv[1:] or list(VARIANTS)
out = ROOT / "out" / "variants"
shutil.rmtree(out, ignore_errors=True)
for key in only:
    label, files, subs = VARIANTS[key]
    app = out / f"src-{key}"
    shutil.copytree(ROOT / "app", app, ignore=shutil.ignore_patterns("render-samples.json"))
    m = json.loads((app / "manifest.json").read_text())
    m["name"] = f"Mahle eBike {key.upper()}"
    m["modificationTime"] = int(time.time())
    (app / "manifest.json").write_text(json.dumps(m, indent=2))
    for name, text in files.items():
        (app / name).write_text(f"// variant {key}: {label}\n" + text)
    for name, old, new in subs:
        t = (app / name).read_text()
        assert old in t, (name, old)
        (app / name).write_text(t.replace(old, new))
    appid = f"mahle{key}01"
    dst = out / appid
    dst.mkdir(parents=True)
    r = subprocess.run(["node", str(TOOL), "--appID", appid, "--input", str(app), "--output", str(dst), "--displayID", "q"],
                       capture_output=True, text=True)
    print(appid, label, "ok" if r.returncode == 0 else "FAILED\n" + r.stdout + r.stderr)
    for f in dst.glob("*.dev"):
        shutil.copy(f, out / f.name)
