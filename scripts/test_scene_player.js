const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeClassList {
    constructor() {
        this.values = new Set();
    }

    add(...names) {
        for (const name of names) this.values.add(name);
    }

    remove(...names) {
        for (const name of names) this.values.delete(name);
    }

    contains(name) {
        return this.values.has(name);
    }

    toggle(name, force) {
        const enabled = force === undefined ? !this.values.has(name) : force;
        if (enabled) this.values.add(name);
        else this.values.delete(name);
        return enabled;
    }
}

function createElement() {
    const listeners = new Map();
    return {
        classList: new FakeClassList(),
        style: {
            animationPlayState: '',
            removeProperty() {},
            setProperty() {},
        },
        parentElement: { clientHeight: 600, clientWidth: 900 },
        complete: true,
        naturalWidth: 1024,
        offsetHeight: 600,
        offsetWidth: 900,
        scrollTop: 0,
        innerHTML: '',
        innerText: '',
        src: '',
        addEventListener(type, listener) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(listener);
        },
        removeEventListener(type, listener) {
            const handlers = listeners.get(type) || [];
            listeners.set(type, handlers.filter((handler) => handler !== listener));
        },
        dispatch(type, event = {}) {
            for (const listener of listeners.get(type) || []) listener({ target: this, type, ...event });
        },
        setAttribute() {},
    };
}

function createFakeTimers() {
    let nextId = 1;
    const timers = new Map();
    return {
        setTimeout(callback) {
            const id = nextId++;
            timers.set(id, callback);
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        async flushAll() {
            while (timers.size) {
                const callbacks = [...timers.values()];
                timers.clear();
                for (const callback of callbacks) callback();
                await Promise.resolve();
            }
        },
    };
}

function loadStoryComic(timers = createFakeTimers(), ImageClass = class {}) {
    const document = {
        addEventListener() {},
        createElement,
    };
    const window = {
        addEventListener() {},
        location: { hash: '' },
    };
    const context = vm.createContext({
        console,
        document,
        window,
        history: { replaceState() {} },
        Image: ImageClass,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        Promise,
    });
    const scriptPath = path.join(__dirname, '..', 'script.js');
    const source = `${fs.readFileSync(scriptPath, 'utf8')}\nglobalThis.StoryComic = StoryComic;`;
    vm.runInContext(source, context, { filename: scriptPath });
    return { StoryComic: context.StoryComic, timers };
}

function createComic(StoryComic) {
    let playCalls = 0;
    let loadCalls = 0;
    const comic = Object.create(StoryComic.prototype);
    comic.audio = {
        currentTime: 12.5,
        readyState: 4,
        paused: false,
        ended: false,
        src: 'chapter.m4a',
        load() {
            loadCalls += 1;
        },
        play() {
            playCalls += 1;
            return Promise.resolve();
        },
        pause() {
            this.paused = true;
        },
    };
    comic.image = createElement();
    comic.textContainer = createElement();
    comic.indicator = createElement();
    comic.progressBar = createElement();
    comic.chapterNav = { querySelectorAll: () => [] };
    comic.btnPrev = createElement();
    comic.btnNext = createElement();
    comic.scenes = [
        { slideNumber: 1, startTime: 0, audioSrc: 'chapter.m4a', image: 'one.webp', text: 'One', chapterId: 'chapter' },
        { slideNumber: 2, startTime: 10, audioSrc: 'chapter.m4a', image: 'two.webp', text: 'Two', chapterId: 'chapter' },
        { slideNumber: 3, startTime: 20, audioSrc: 'chapter.m4a', image: 'three.webp', text: 'Three', chapterId: 'chapter' },
    ];
    comic.chapters = [{ id: 'chapter', title: 'Chapter', firstSlide: 1 }];
    comic.availableChapterIds = new Set(['chapter']);
    comic.currentSceneIndex = 0;
    comic.pendingSceneIndex = null;
    comic.currentAudioSrc = 'chapter.m4a';
    comic.pendingSeek = null;
    comic.fadeDurationMs = 800;
    comic.fadeLeadSeconds = 0.8;
    comic.endCardSceneIndex = -1;
    comic.transitionToken = 0;
    comic.frameIsFadedOut = false;
    comic.placeholderImageSrc = 'placeholder.svg';
    comic.preloadQueue = [];
    comic.queuedImageUrls = new Set();
    comic.imageCache = new Map();
    comic.imageCacheClock = 0;
    comic.maxCachedImages = 14;
    comic.pinnedImageUrls = new Set();
    comic.activeBackgroundLoads = 0;
    comic.maxBackgroundLoads = 2;
    comic.preloadAround = () => {};
    comic.getAudioCallCounts = () => ({ playCalls, loadCalls });
    return comic;
}

const failures = [];

async function test(name, callback) {
    try {
        await callback();
        console.log(`PASS ${name}`);
    } catch (error) {
        failures.push({ name, error });
        console.error(`FAIL ${name}: ${error.message}`);
    }
}

(async () => {
    await test('automatic scene rendering never rewinds or restarts narration', async () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);

        await comic.renderScene(1, { audioAction: 'none' });

        assert.equal(comic.audio.currentTime, 12.5, 'automatic rendering must not seek backward');
        assert.deepEqual(comic.getAudioCallCounts(), { playCalls: 0, loadCalls: 0 });
    });

    await test('time-driven transitions request display-only audio behavior', () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        comic.audio.currentTime = 9.3;
        let transition = null;
        comic.transitionToScene = (index, options) => {
            transition = { index, options };
        };

        comic.handleTimeUpdate();

        assert.equal(transition.index, 1);
        assert.equal(transition.options.audioAction, 'none');
        assert.equal('forceSeek' in transition.options, false);
        assert.equal('autoPlay' in transition.options, false);
    });

    await test('a delayed automatic transition cannot rewind, reload, or resume paused audio', async () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        let finishFade;
        comic.audio.currentTime = 9.3;
        comic.fadeOutFrame = () => new Promise((resolve) => {
            finishFade = resolve;
        });
        comic.promoteImage = () => Promise.resolve();
        comic.setDisplayImage = async (src) => {
            comic.image.src = src;
        };
        comic.revealFrame = () => {};

        const transition = comic.transitionToScene(1, { audioAction: 'none' });
        comic.audio.currentTime = 12.4;
        comic.audio.paused = true;
        finishFade();
        await transition;

        assert.equal(comic.audio.currentTime, 12.4);
        assert.equal(comic.audio.paused, true);
        assert.deepEqual(comic.getAudioCallCounts(), { playCalls: 0, loadCalls: 0 });
    });

    await test('time-driven transitions catch up to the latest scene on the audio timeline', () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        comic.audio.currentTime = 20.5;
        let transition = null;
        comic.transitionToScene = (index, options) => {
            transition = { index, options };
        };

        comic.handleTimeUpdate();

        assert.equal(transition.index, 2);
        assert.equal(transition.options.audioAction, 'none');
    });

    await test('playback supersedes an image that falls multiple scenes behind', async () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        let finishStaleImage;
        comic.fadeOutFrame = () => Promise.resolve();
        comic.promoteImage = (src) => (
            src === 'two.webp'
                ? new Promise((resolve) => {
                    finishStaleImage = resolve;
                })
                : Promise.resolve()
        );
        comic.setDisplayImage = async (src) => {
            comic.image.src = src;
        };
        comic.revealFrame = () => {};
        let catchUpTransition;
        const transitionToScene = comic.transitionToScene.bind(comic);
        comic.transitionToScene = (...args) => {
            const transition = transitionToScene(...args);
            if (args[0] === 2) catchUpTransition = transition;
            return transition;
        };

        const staleTransition = comic.transitionToScene(1, { audioAction: 'none' });
        comic.audio.currentTime = 20.5;
        comic.handleTimeUpdate();
        await catchUpTransition;
        finishStaleImage();
        await staleTransition;

        assert.equal(comic.currentSceneIndex, 2);
        assert.equal(comic.image.src, 'three.webp');
        assert.deepEqual(comic.getAudioCallCounts(), { playCalls: 0, loadCalls: 0 });
    });

    await test('a late image stays faded instead of revealing the previous bitmap', async () => {
        const { StoryComic, timers } = loadStoryComic();
        const comic = createComic(StoryComic);
        comic.renderScene = () => {};
        comic.loadImage = () => new Promise(() => {});

        comic.transitionToScene(1, { smoothFade: true, audioAction: 'none' });
        await timers.flushAll();

        assert.equal(comic.image.classList.contains('fade-out'), true);
        assert.equal(comic.textContainer.classList.contains('fade-out'), true);
    });

    await test('image loading is decoded once and deduplicated by URL', async () => {
        class ImmediateImage {
            static instances = [];

            constructor() {
                this.complete = false;
                this.naturalWidth = 0;
                this.decodeCalls = 0;
                ImmediateImage.instances.push(this);
            }

            set src(value) {
                this._src = value;
                this.complete = true;
                this.naturalWidth = 1024;
                Promise.resolve().then(() => this.onload?.());
            }

            get src() {
                return this._src;
            }

            decode() {
                this.decodeCalls += 1;
                return Promise.resolve();
            }
        }

        const { StoryComic } = loadStoryComic(createFakeTimers(), ImmediateImage);
        const comic = createComic(StoryComic);
        comic.imageCache = new Map();
        comic.imageCacheClock = 0;
        comic.maxCachedImages = 14;
        comic.pinnedImageUrls = new Set();

        const first = comic.loadImage('one.webp', { priority: 'high' });
        const second = comic.loadImage('one.webp', { priority: 'low' });
        const [firstImage, secondImage] = await Promise.all([first, second]);

        assert.equal(firstImage, secondImage);
        assert.equal(ImmediateImage.instances.length, 1);
        assert.equal(firstImage.decodeCalls, 1);
    });

    await test('preloading keeps a bounded closest-first window plus chapter anchors', () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        comic.scenes = Array.from({ length: 10 }, (_, index) => ({
            slideNumber: index + 1,
            startTime: index * 10,
            audioSrc: index < 7 ? 'first.m4a' : 'second.m4a',
            image: `scene-${index + 1}.webp`,
            text: `Scene ${index + 1}`,
            chapterId: index < 7 ? 'first' : 'second',
        }));
        comic.chapters = [
            { id: 'first', firstSlide: 1 },
            { id: 'second', firstSlide: 8 },
        ];
        comic.availableChapterIds = new Set(['first', 'second']);
        comic.imageCache = new Map();
        comic.preloadQueue = [];
        comic.queuedImageUrls = new Set();
        comic.pinnedImageUrls = new Set();
        comic.preloadAround = StoryComic.prototype.preloadAround;
        const queued = [];
        comic.queueImagePreload = (src) => queued.push(src);

        comic.preloadAround(4);

        assert.deepEqual(queued, [
            'scene-6.webp',
            'scene-4.webp',
            'scene-7.webp',
            'scene-3.webp',
            'scene-8.webp',
            'scene-9.webp',
            'scene-10.webp',
            'scene-1.webp',
        ]);
        assert.deepEqual(
            [...comic.pinnedImageUrls].sort(),
            [
                'scene-1.webp',
                'scene-3.webp',
                'scene-4.webp',
                'scene-5.webp',
                'scene-6.webp',
                'scene-7.webp',
                'scene-8.webp',
                'scene-9.webp',
                'scene-10.webp',
            ].sort(),
        );
    });

    await test('background preloading never exceeds two concurrent requests', async () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        const pending = [];
        let active = 0;
        let peak = 0;
        comic.loadImage = (src) => new Promise((resolve) => {
            active += 1;
            peak = Math.max(peak, active);
            pending.push({
                src,
                resolve() {
                    active -= 1;
                    resolve();
                },
            });
        });

        for (let index = 0; index < 5; index++) comic.queueImagePreload(`queued-${index}.webp`);
        assert.equal(pending.length, 2);
        assert.equal(peak, 2);

        pending[0].resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(pending.length, 3);
        assert.equal(peak, 2);
    });

    await test('the decoded-image cache evicts old entries but retains pinned images', async () => {
        class ImmediateImage {
            constructor() {
                this.complete = false;
                this.naturalWidth = 0;
            }

            set src(value) {
                this._src = value;
                this.complete = true;
                this.naturalWidth = 1024;
                Promise.resolve().then(() => this.onload?.());
            }

            decode() {
                return Promise.resolve();
            }
        }

        const { StoryComic } = loadStoryComic(createFakeTimers(), ImmediateImage);
        const comic = createComic(StoryComic);
        comic.pinnedImageUrls = new Set(['cached-0.webp']);

        await Promise.all(
            Array.from({ length: 16 }, (_, index) => comic.loadImage(`cached-${index}.webp`)),
        );

        assert.equal(comic.imageCache.size, 14);
        assert.equal(comic.imageCache.has('cached-0.webp'), true);
    });

    await test('a stale chapter image cannot overwrite a newer transition', async () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        const pending = new Map();
        const commits = [];
        comic.fadeOutFrame = () => Promise.resolve();
        comic.promoteImage = (src) => new Promise((resolve) => pending.set(src, resolve));
        comic.setDisplayImage = async (src) => {
            comic.image.src = src;
        };
        comic.renderScene = (index) => {
            commits.push(index);
            comic.currentSceneIndex = index;
            comic.pendingSceneIndex = null;
        };
        comic.revealFrame = () => {};

        const firstTransition = comic.transitionToScene(1, { audioAction: 'none' });
        const secondTransition = comic.transitionToScene(2, { audioAction: 'none' });
        pending.get('three.webp')();
        await secondTransition;
        pending.get('two.webp')();
        await firstTransition;

        assert.deepEqual(commits, [2]);
        assert.equal(comic.image.src, 'three.webp');
    });

    await test('the end card invalidates an in-flight scene transition', async () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        let finishTargetImageLoad;
        const commits = [];
        comic.fadeOutFrame = () => Promise.resolve();
        comic.promoteImage = (src) => (
            src === 'two.webp'
                ? new Promise((resolve) => {
                    finishTargetImageLoad = resolve;
                })
                : Promise.resolve()
        );
        comic.setDisplayImage = async (src) => {
            comic.image.src = src;
        };
        comic.renderScene = (index) => commits.push(index);
        comic.revealFrame = () => {};

        const transition = comic.transitionToScene(1, { audioAction: 'none' });
        await comic.renderEndCard();
        finishTargetImageLoad();
        await transition;

        assert.deepEqual(commits, []);
        assert.equal(comic.textContainer.innerHTML, 'To be continued ...');
    });

    await test('a cancelled fade cannot mark a visible end card as faded', async () => {
        const { StoryComic, timers } = loadStoryComic();
        const comic = createComic(StoryComic);
        comic.promoteImage = () => Promise.resolve();
        comic.setDisplayImage = async (src) => {
            comic.image.src = src;
        };

        comic.fadeOutFrame(true);
        const endCard = comic.renderEndCard();
        await timers.flushAll();
        await endCard;

        assert.equal(comic.frameIsFadedOut, false);
        assert.equal(comic.image.classList.contains('fade-out'), false);
    });

    await test('the end-card image stays black until it has decoded', async () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        comic.endCardSceneIndex = 2;
        let finishImageLoad;
        comic.fadeOutFrame = () => {
            comic.image.classList.add('fade-out');
            comic.textContainer.classList.add('fade-out');
            return Promise.resolve();
        };
        comic.promoteImage = () => new Promise((resolve) => {
            finishImageLoad = resolve;
        });
        comic.setDisplayImage = async (src) => {
            comic.image.src = src;
        };

        const endCard = comic.renderEndCard();
        await Promise.resolve();
        assert.equal(comic.image.classList.contains('fade-out'), true);

        finishImageLoad();
        await endCard;

        assert.equal(comic.image.src, 'three.webp');
        assert.equal(comic.image.classList.contains('fade-out'), false);
        assert.equal(comic.textContainer.innerHTML, 'To be continued ...');
    });

    await test('image failure reveals the placeholder without blocking the scene', async () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        let displayedSrc = null;
        comic.fadeOutFrame = () => Promise.resolve();
        comic.promoteImage = (src) => (
            src === 'two.webp' ? Promise.reject(new Error('network failure')) : Promise.resolve()
        );
        comic.setDisplayImage = async (src) => {
            displayedSrc = src;
        };
        comic.revealFrame = () => {};
        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            await comic.transitionToScene(1, { audioAction: 'none' });
        } finally {
            console.warn = originalWarn;
        }

        assert.equal(displayedSrc, 'placeholder.svg');
        assert.equal(comic.currentSceneIndex, 1);
    });

    await test('display decode failure retries with the placeholder', async () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        const displayAttempts = [];
        comic.fadeOutFrame = () => Promise.resolve();
        comic.promoteImage = () => Promise.resolve();
        comic.setDisplayImage = async (src) => {
            displayAttempts.push(src);
            if (src === 'two.webp') throw new Error('decode failure');
        };
        comic.revealFrame = () => {};
        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            await comic.transitionToScene(1, { audioAction: 'none' });
        } finally {
            console.warn = originalWarn;
        }

        assert.deepEqual(displayAttempts, ['two.webp', 'placeholder.svg']);
        assert.equal(comic.currentSceneIndex, 1);
    });

    await test('chapter rollover explicitly seeks and plays once', () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        comic.chapters = [
            { id: 'chapter', firstSlide: 1 },
            { id: 'next', firstSlide: 3 },
        ];
        comic.scenes[2].chapterId = 'next';
        comic.scenes[2].audioSrc = 'next.m4a';
        comic.availableChapterIds.add('next');
        comic.currentSceneIndex = 1;
        let transition = null;
        comic.transitionToScene = (index, options) => {
            transition = { index, options };
        };

        comic.handleAudioEnded();

        assert.equal(transition.index, 2);
        assert.equal(transition.options.audioAction, 'seek-and-play');
        assert.equal('forceSeek' in transition.options, false);
        assert.equal('autoPlay' in transition.options, false);
    });

    await test('manual navigation explicitly seeks without starting playback', async () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        let navigationTransition;
        comic.audio.paused = true;
        comic.audio.currentTime = 4;
        comic.fadeOutFrame = () => Promise.resolve();
        comic.promoteImage = () => Promise.resolve();
        comic.setDisplayImage = async (src) => {
            comic.image.src = src;
        };
        comic.revealFrame = () => {};
        const transitionToScene = comic.transitionToScene.bind(comic);
        comic.transitionToScene = (...args) => {
            navigationTransition = transitionToScene(...args);
            return navigationTransition;
        };

        comic.goToNextScene();
        await navigationTransition;

        assert.equal(comic.currentSceneIndex, 1);
        assert.equal(comic.audio.currentTime, 10);
        assert.equal(comic.audio.paused, true);
        assert.deepEqual(comic.getAudioCallCounts(), { playCalls: 0, loadCalls: 0 });
    });

    await test('chapter rollover waits for metadata before playing and plays only once', () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        comic.transitionToken = 7;
        comic.audio.readyState = 0;
        comic.audio.currentTime = 99;

        comic.applyAudioAction(comic.scenes[0], 'seek-and-play', 7);
        assert.deepEqual(comic.getAudioCallCounts(), { playCalls: 0, loadCalls: 0 });

        comic.handleLoadedMetadata();
        comic.handleLoadedMetadata();

        assert.equal(comic.audio.currentTime, 0);
        assert.deepEqual(comic.getAudioCallCounts(), { playCalls: 1, loadCalls: 0 });
    });

    await test('metadata from a superseded seek cannot move the audio clock', () => {
        const { StoryComic } = loadStoryComic();
        const comic = createComic(StoryComic);
        comic.transitionToken = 10;
        comic.audio.readyState = 0;
        comic.audio.currentTime = 37;

        comic.applyAudioAction(comic.scenes[0], 'seek', 10);
        comic.transitionToken = 11;
        comic.handleLoadedMetadata();

        assert.equal(comic.audio.currentTime, 37);
        assert.deepEqual(comic.getAudioCallCounts(), { playCalls: 0, loadCalls: 0 });
    });

    if (failures.length) {
        console.error(`\n${failures.length} scene player regression test(s) failed.`);
        process.exitCode = 1;
    } else {
        console.log('\nScene player regression tests passed.');
    }
})();
