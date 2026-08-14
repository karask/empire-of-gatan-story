---
description: Report images in assets/images that no scene references any more
---

All scene images live in `assets/images`. This workflow lists the ones that no
longer appear in `data.js`, `index.html`, `script.js` or `styles.css`, so leftover
generation drafts do not pile up.

The script only reports — review the list and delete with `git rm` yourself.

// turbo
1. List unreferenced images
```bash
node scripts/find_unused_images.js
```
