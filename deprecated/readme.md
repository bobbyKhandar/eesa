# Deprecated Archive

This folder contains legacy code that was once part of the active codebase but has since been replaced by newer tools, architectures, or implementations.

## Purpose

The sole purpose of this folder is **reference**.
As the codebase evolves, older methods may be superseded by more efficient or maintainable solutions. However, in large or legacy-integrated systems, referencing deprecated logic can be valuable — especially for debugging regressions, understanding historical decisions, or maintaining compatibility.

> Do not reuse code from this folder in production without review.

## Contents

| File             | Replaced By                    | Reason                   |
| ---------------- | -------------------------------|------------------------- |
| `olddb.js`       | `db/db.js`                     | Switched to more cleaner |
|                  |                                |alternative               |
| `pdfScapler.js`  |`ai-pipeline\imagePreprocess.py`|changed from tessarace to |
|                  |                                |easy ocr                  |
| `clusterTest.py` | `src/cluster/cluster.py`       | Integrated into pipeline |
