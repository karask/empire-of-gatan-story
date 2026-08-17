const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const buttons = [];
const chapterNav = {
    innerHTML: '',
    appendChild(button) {
        buttons.push(button);
    },
};

const document = {
    addEventListener() {},
    createElement() {
        return {
            className: '',
            dataset: {},
            handlers: {},
            setAttribute() {},
            addEventListener(type, handler) {
                this.handlers[type] = handler;
            },
        };
    },
};

const context = vm.createContext({ console, document, window: {} });
const scriptPath = path.join(__dirname, '..', 'script.js');
const source = `${fs.readFileSync(scriptPath, 'utf8')}\nglobalThis.StoryComic = StoryComic;`;
vm.runInContext(source, context, { filename: scriptPath });

let pauseCalls = 0;
let transition = null;
const comic = Object.create(context.StoryComic.prototype);
comic.audio = {
    pause() {
        pauseCalls += 1;
    },
};
comic.chapterNav = chapterNav;
comic.chapters = [{ id: 'chapter-3', title: 'Chapter 3', firstSlide: 204 }];
comic.scenes = [{ slideNumber: 204 }];
comic.availableChapterIds = new Set(['chapter-3']);
comic.transitionToScene = (index, options) => {
    transition = { index, options };
};

comic.renderChapterNav();
buttons[0].handlers.click();

assert.equal(pauseCalls, 1, 'chapter selection pauses the current audio');
assert.deepEqual(
    JSON.parse(JSON.stringify(transition)),
    {
        index: 0,
        options: { smoothFade: true, forceSeek: true, autoPlay: false },
    },
    'chapter selection seeks to the first scene without autoplaying',
);

console.log('Chapter selection pauses and waits for explicit play.');
