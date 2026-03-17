import re
import os
import glob
import statistics as st

LOG_DIR = "stress_logs"

PATTERN_RPS = re.compile(r"Requests per second:\s+([\d\.]+)")
PATTERN_FAIL = re.compile(r"Failed requests:\s+(\d+)")
PATTERN_MEAN = re.compile(r"Time per request:\s+([\d\.]+)\s+\[ms\]\s+\(mean\)")
PATTERN_95 = re.compile(r"\s*95%\s+(\d+)")

def parse_ab_file(path):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()
    rps   = PATTERN_RPS.search(text)
    fail  = PATTERN_FAIL.search(text)
    mean  = PATTERN_MEAN.search(text)
    p95   = PATTERN_95.search(text)
    return {
        "file": os.path.basename(path),
        "rps": float(rps.group(1)) if rps else None,
        "failed": int(fail.group(1)) if fail else None,
        "mean_ms": float(mean.group(1)) if mean else None,
        "p95_ms": float(p95.group(1)) if p95 else None,
    }

def main():
    paths = glob.glob(os.path.join(LOG_DIR, "ab_*.txt"))
    if not paths:
        print(f"No ab_*.txt files found under {LOG_DIR}")
        return

    results = [parse_ab_file(p) for p in paths]
    print("=== Individual runs ===")
    for r in results:
        print(f"{r['file']}: RPS={r['rps']}, mean={r['mean_ms']} ms, p95={r['p95_ms']} ms, failed={r['failed']}")

    valid_rps = [r["rps"] for r in results if r["rps"] is not None]
    valid_p95 = [r["p95_ms"] for r in results if r["p95_ms"] is not None]

    if valid_rps:
        print("\n=== Summary ===")
        print(f"Runs analyzed: {len(valid_rps)}")
        print(f"Avg RPS: {st.mean(valid_rps):.2f}")
        print(f"Max RPS: {max(valid_rps):.2f}")
    if valid_p95:
        print(f"Median p95 latency: {st.median(valid_p95):.2f} ms")

if __name__ == "__main__":
    main()