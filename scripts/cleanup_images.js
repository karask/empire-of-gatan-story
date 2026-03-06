const fs = require('fs');
const path = require('path');

const dataJsPath = path.join(__dirname, '../data.js');
const sourceDir = path.join(__dirname, '../assets/images');
const destDir = path.join(__dirname, '../images');

try {
    const dataJsContent = fs.readFileSync(dataJsPath, 'utf8');

    // Find all image references like: image: "assets/images/filename.png"
    const regex = /image:\s*["']([^"']+)["']/g;
    const referencedImages = new Set();
    let match;
    while ((match = regex.exec(dataJsContent)) !== null) {
        referencedImages.add(path.basename(match[1]));
    }

    const allImages = fs.readdirSync(sourceDir).filter(file => {
        return fs.statSync(path.join(sourceDir, file)).isFile() && /\.(png|jpe?g|gif|webp)$/i.test(file);
    });

    const unusedImages = allImages.filter(img => !referencedImages.has(img));

    console.log(`Found ${unusedImages.length} unused images. Moving them to /images...`);

    if (unusedImages.length > 0) {
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        let movedCount = 0;
        unusedImages.forEach(img => {
            const sourcePath = path.join(sourceDir, img);
            const destPath = path.join(destDir, img);
            fs.renameSync(sourcePath, destPath);
            console.log(`Moved: ${img}`);
            movedCount++;
        });

        console.log(`Successfully moved ${movedCount} unused images.`);
    } else {
        console.log('No unused images found.');
    }
} catch (e) {
    console.error("Error:", e);
}
