#!/usr/bin/env bash
# ==============================================================================
# Flipit Finder V3 — Raw Dataset Download Script
# Downloads Princeton WordNet 3.0, Moby Thesaurus II, and Moby Compound Words.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RAW_DIR="${PROJECT_ROOT}/data/v3/raw"
WORDNET_DIR="${RAW_DIR}/wordnet"
MOBY_DIR="${RAW_DIR}/moby"

mkdir -p "${WORDNET_DIR}" "${MOBY_DIR}"

echo "======================================================================"
echo " Flipit Finder V3 — Dataset Ingestion Pipeline"
echo "======================================================================"

# 1. Princeton WordNet 3.0
if [ -d "${WORDNET_DIR}/dict" ] && [ -f "${WORDNET_DIR}/dict/data.noun" ]; then
  echo "[✓] WordNet 3.0 dict files already present in ${WORDNET_DIR}/dict"
else
  echo "[1/3] Downloading Princeton WordNet 3.0..."
  curl -sSL "https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz" -o "${WORDNET_DIR}/WordNet-3.0.tar.gz"
  echo "      Extracting WordNet 3.0..."
  tar -xzf "${WORDNET_DIR}/WordNet-3.0.tar.gz" -C "${WORDNET_DIR}" --strip-components=1
  rm -f "${WORDNET_DIR}/WordNet-3.0.tar.gz"
  echo "[✓] WordNet 3.0 downloaded and extracted."
fi

# 2. Moby Compound Words
if [ -f "${MOBY_DIR}/compound.txt" ] && [ -s "${MOBY_DIR}/compound.txt" ]; then
  echo "[✓] Moby Compound Words already present: ${MOBY_DIR}/compound.txt"
else
  echo "[2/3] Downloading Moby Compound Words (Gutenberg #3201)..."
  curl -sSL "https://www.gutenberg.org/files/3201/files/compound.txt" -o "${MOBY_DIR}/compound.txt"
  echo "[✓] Moby Compound Words downloaded."
fi

# 3. Moby Thesaurus II
if [ -f "${MOBY_DIR}/mthesaur.txt" ] && [ -s "${MOBY_DIR}/mthesaur.txt" ]; then
  echo "[✓] Moby Thesaurus II already present: ${MOBY_DIR}/mthesaur.txt"
else
  echo "[3/3] Downloading Moby Thesaurus II (Gutenberg #3202)..."
  curl -sSL "https://www.gutenberg.org/files/3202/files/mthesaur.txt" -o "${MOBY_DIR}/mthesaur.txt"
  echo "[✓] Moby Thesaurus II downloaded."
fi

echo "======================================================================"
echo " All V3 raw datasets verified in ${RAW_DIR}"
echo "======================================================================"
