// Reports images in assets/images that no longer appear in data.js, index.html,
// script.js or styles.css. Read-only: it never moves or deletes anything.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const imageDir = path.join(root, 'assets', 'images');
const sources = ['data.js', 'index.html', 'script.js', 'styles.css'];

const referenced = new Set();
for (const source of sources) {
    const content = fs.readFileSync(path.join(root, source), 'utf8');
    // Matches both `image: "..."` and the JSON-quoted `"image": "..."` used in data.js,
    // plus plain src="assets/images/..." references in index.html.
    const regex = /(?:["']?image["']?\s*:|src\s*=)\s*["']([^"']+)["']/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        referenced.add(path.basename(match[1]));
    }
}

const unused = fs.readdirSync(imageDir)
    .filter((file) => /\.(png|jpe?g|gif|webp|svg)$/i.test(file))
    .filter((file) => !referenced.has(file))
    .sort();

if (unused.length === 0) {
    console.log('No unused images in assets/images.');
    process.exit(0);
}

console.log(`${unused.length} unused image(s) in assets/images:`);
for (const file of unused) {
    console.log(`  ${path.join('assets/images', file)}`);
}
console.log('\nNothing was changed. Remove them with `git rm` once you have checked the list.');
process.exit(1);
