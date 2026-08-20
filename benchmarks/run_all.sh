#!/usr/bin/env bash
# noc full regression: semantic mechanisms + scenario matrix
# run from anywhere; requires python3 + live endpoint (Bearer in .dev.vars)
set -e
cd "$(dirname "$0")/.."
echo "=== [1/2] semantic tests ==="
python3 benchmarks/noc_semantic_test.py
echo "=== [2/2] scenario matrix ==="
python3 benchmarks/noc_scenario_loop.py
echo "=== ALL GREEN ==="
