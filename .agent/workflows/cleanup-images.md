---
description: Move unused images from assets/images to the root images directory
---

This workflow runs a script to clean up unreferenced images in the `assets/images` folder so that it stays organized. Run this to automate moving unused images.

// turbo
1. Run the cleanup script to move unused images to `/images`
```bash
node scripts/cleanup_images.js
```
