---
section: introduction
status: approved
hash: 2272c193319e6e60273cda960ba7cc1133ff45d01dc33319e37ea7fdf6410c8b
updated: 2026-09-01T00:00:48.000Z
---

Eight-bit post-training quantization changes exact-match accuracy on this benchmark by less
than half a point across five seeds [@aoki2024posttraining].
<!-- claim: CLAIM-4b634ae3b0 -->

The same recipe cuts mean latency at a fixed batch size from 240 ms to 150 ms, which is the
reason the trade is made at all.

What it costs under prompts the recipe was not calibrated against is not settled. Two
preprints report the same recipe and do not agree, so this paper asks what the accuracy cost
is once the evaluation prompts are held out.
