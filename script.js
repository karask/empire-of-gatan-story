class StoryComic {
    constructor() {
        this.audio = document.getElementById('story-audio');
        this.image = document.getElementById('scene-image');
        this.textContainer = document.getElementById('scene-text');
        this.indicator = document.getElementById('scene-indicator');
        this.progressBar = document.getElementById('progress-bar-fill');
        this.chapterNav = document.getElementById('chapter-nav');
        this.btnPrev = document.getElementById('btn-prev');
        this.btnNext = document.getElementById('btn-next');

        this.currentSceneIndex = -1;
        this.scenes = window.storyScenes || [];
        this.chapters = window.storyChapters || [];
        this.currentAudioSrc = "";
        this.pendingSceneIndex = null;
        this.pendingSeek = null;
        this.availableChapterIds = new Set(['introduction', 'chapter-1', 'chapter-2', 'chapter-3', 'chapter-4']);
        this.endCardSceneIndex = this.scenes.findIndex((scene) => !this.isSceneAvailable(scene));
        this.fadeDurationMs = 800;
        this.fadeLeadSeconds = this.fadeDurationMs / 1000;
        this.imageCache = new Map();
        this.imageCacheClock = 0;
        this.maxCachedImages = 14;
        this.pinnedImageUrls = new Set();
        this.preloadQueue = [];
        this.queuedImageUrls = new Set();
        this.activeBackgroundLoads = 0;
        this.maxBackgroundLoads = 2;
        this.transitionToken = 0;
        this.frameIsFadedOut = false;
        this.placeholderImageSrc = 'assets/images/soon.svg';

        this.init();
    }

    init() {
        if (this.scenes.length === 0) {
            this.textContainer.innerText = "Error: Scene data not found.";
            return;
        }

        this.renderChapterNav();

        this.audio.addEventListener('timeupdate', () => this.handleTimeUpdate());
        this.audio.addEventListener('ended', () => this.handleAudioEnded());
        this.audio.addEventListener('play', () => this.handleAudioPlay());
        this.audio.addEventListener('pause', () => this.handleAudioPause());
        this.audio.addEventListener('loadedmetadata', () => this.handleLoadedMetadata());
        this.btnNext.addEventListener('click', () => this.goToNextScene());
        this.btnPrev.addEventListener('click', () => this.goToPrevScene());
        window.addEventListener('resize', () => this.handleResize());

        let startIndex = 0;
        const hash = window.location.hash;
        if (hash) {
            const match = hash.match(/\d+/);
            if (match) {
                const requestedSlide = parseInt(match[0], 10);
                if (requestedSlide > 0 && requestedSlide <= this.scenes.length) {
                    startIndex = requestedSlide - 1;
                }
            }
        }

        if (!this.isSceneAvailable(this.scenes[startIndex])) {
            this.renderEndCard();
            return;
        }

        this.transitionToScene(startIndex, { smoothFade: false, audioAction: 'seek' });
    }

    renderChapterNav() {
        if (!this.chapterNav || this.chapters.length === 0) return;

        this.chapterNav.innerHTML = "";
        for (const chapter of this.chapters) {
            const isAvailable = this.isChapterAvailable(chapter);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `chapter-tab${isAvailable ? '' : ' unavailable'}`;
            button.dataset.chapterId = chapter.id;
            button.textContent = chapter.title;
            button.setAttribute('aria-disabled', String(!isAvailable));

            if (isAvailable) {
                const firstSceneIndex = this.scenes.findIndex((scene) => scene.slideNumber === chapter.firstSlide);
                const warmChapterImage = () => {
                    if (firstSceneIndex < 0) return;
                    this.promoteImage(this.scenes[firstSceneIndex].image).catch(() => {});
                };
                button.addEventListener('pointerenter', warmChapterImage);
                button.addEventListener('focus', warmChapterImage);
                button.addEventListener('touchstart', warmChapterImage);
                button.addEventListener('click', () => {
                    if (firstSceneIndex >= 0) {
                        this.audio.pause();
                        this.transitionToScene(firstSceneIndex, { smoothFade: true, audioAction: 'seek' });
                    }
                });
            }

            this.chapterNav.appendChild(button);
        }
    }

    handleAudioPlay() {
        this.image.style.animationPlayState = 'running';
        this.updateNavigationButtons();
    }

    handleAudioPause() {
        this.image.style.animationPlayState = 'paused';
        this.updateNavigationButtons();
    }

    handleAudioEnded() {
        this.updateNavigationButtons();
        const currentChapter = this.getChapterForScene(this.scenes[this.currentSceneIndex]);
        if (!currentChapter) return;

        const currentChapterIndex = this.chapters.findIndex((chapter) => chapter.id === currentChapter.id);
        const nextChapter = this.chapters[currentChapterIndex + 1];
        if (!nextChapter || !this.isChapterAvailable(nextChapter)) {
            this.renderEndCard();
            return;
        }

        const nextSceneIndex = this.scenes.findIndex((scene) => scene.slideNumber === nextChapter.firstSlide);
        if (nextSceneIndex >= 0) {
            this.transitionToScene(nextSceneIndex, { smoothFade: true, audioAction: 'seek-and-play' });
        }
    }

    handleLoadedMetadata() {
        const pendingSeek = this.pendingSeek;
        if (!pendingSeek) return;

        this.pendingSeek = null;
        if (
            pendingSeek.audioSrc !== this.currentAudioSrc
            || pendingSeek.token !== this.transitionToken
        ) return;

        this.audio.currentTime = pendingSeek.time;
        if (pendingSeek.playAfterSeek) this.playAudio();
    }

    handleTimeUpdate() {
        if (this.currentSceneIndex < 0) return;

        const currentScene = this.scenes[this.currentSceneIndex];
        const audioSrc = this.currentAudioSrc || currentScene.audioSrc;
        const targetIndex = this.findSceneIndexAtTime(audioSrc, this.audio.currentTime + this.fadeLeadSeconds);
        if (targetIndex < 0 || targetIndex === this.currentSceneIndex || targetIndex === this.pendingSceneIndex) return;

        this.transitionToScene(targetIndex, {
            smoothFade: true,
            audioAction: 'none',
        });
    }

    findSceneIndexAtTime(audioSrc, time) {
        let match = -1;
        for (let index = 0; index < this.scenes.length; index++) {
            const scene = this.scenes[index];
            if (scene.audioSrc !== audioSrc) continue;
            if (!this.isSceneAvailable(scene) || scene.syncStatus === 'unmatched') continue;
            if (scene.startTime > time) break;
            match = index;
        }
        return match;
    }

    async transitionToScene(index, options = {}) {
        const settings = {
            smoothFade: options.smoothFade !== false,
            audioAction: options.audioAction || 'none',
        };

        if (index < 0 || index >= this.scenes.length) return;
        if (!this.isSceneAvailable(this.scenes[index])) {
            this.renderEndCard();
            return;
        }
        if (this.pendingSceneIndex === index || (this.pendingSceneIndex === null && this.currentSceneIndex === index)) return;

        const token = ++this.transitionToken;
        this.pendingSceneIndex = index;
        this.applyAudioAction(this.scenes[index], settings.audioAction, token);

        const fadePromise = this.fadeOutFrame(settings.smoothFade, token);
        const imagePromise = this.promoteImage(this.scenes[index].image).then(
            () => ({ error: null }),
            (error) => ({ error }),
        );
        await fadePromise;
        if (token !== this.transitionToken) return;

        let imageSrc = this.scenes[index].image;
        const imageResult = await imagePromise;
        if (imageResult.error) {
            console.warn(`Scene image failed to load: ${imageSrc}`, imageResult.error);
            imageSrc = this.placeholderImageSrc;
            try {
                await this.promoteImage(imageSrc);
            } catch (placeholderError) {
                console.warn('Scene placeholder failed to load.', placeholderError);
            }
        }
        if (token !== this.transitionToken) return;

        try {
            await this.setDisplayImage(imageSrc);
        } catch (error) {
            console.warn(`Scene image failed to decode: ${imageSrc}`, error);
            imageSrc = this.placeholderImageSrc;
            try {
                await this.promoteImage(imageSrc);
                if (token === this.transitionToken) await this.setDisplayImage(imageSrc);
            } catch (placeholderError) {
                console.warn('Scene placeholder failed to display.', placeholderError);
            }
        }
        if (token !== this.transitionToken) return;

        this.renderScene(index);
        this.revealFrame();
    }

    fadeOutFrame(smoothFade, token = this.transitionToken) {
        this.image.classList.add('fade-out');
        this.textContainer.classList.add('fade-out');
        if (!smoothFade || this.frameIsFadedOut) {
            if (token === this.transitionToken) this.frameIsFadedOut = true;
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                this.image.removeEventListener('transitionend', handleTransitionEnd);
                clearTimeout(timeoutId);
                if (token === this.transitionToken) this.frameIsFadedOut = true;
                resolve();
            };
            const handleTransitionEnd = (event) => {
                if (event.target === this.image && event.propertyName === 'opacity') finish();
            };
            const timeoutId = setTimeout(finish, this.fadeDurationMs + 100);
            this.image.addEventListener('transitionend', handleTransitionEnd);
        });
    }

    revealFrame() {
        this.image.classList.remove('fade-out');
        this.textContainer.classList.remove('fade-out');
        this.frameIsFadedOut = false;
    }

    async setDisplayImage(src) {
        this.image.src = src;
        if (typeof this.image.decode === 'function') {
            try {
                await this.image.decode();
                return;
            } catch (error) {
                if (this.image.complete && this.image.naturalWidth) return;
                throw error;
            }
        }
        if (this.image.complete && this.image.naturalWidth) return;
        await new Promise((resolve, reject) => {
            const finish = (callback, value) => {
                this.image.removeEventListener('load', handleLoad);
                this.image.removeEventListener('error', handleError);
                callback(value);
            };
            const handleLoad = () => finish(resolve);
            const handleError = (error) => finish(reject, error);
            this.image.addEventListener('load', handleLoad);
            this.image.addEventListener('error', handleError);
        });
    }

    preloadAround(index) {
        this.preloadQueue.length = 0;
        this.queuedImageUrls.clear();

        const windowIndexes = [index];
        const queuedIndexes = [];
        for (let distance = 1; distance <= 5; distance++) {
            const nextIndex = index + distance;
            if (nextIndex < this.scenes.length && this.isSceneAvailable(this.scenes[nextIndex])) {
                windowIndexes.push(nextIndex);
                queuedIndexes.push(nextIndex);
            }

            const previousIndex = index - distance;
            if (distance <= 2 && previousIndex >= 0 && this.isSceneAvailable(this.scenes[previousIndex])) {
                windowIndexes.push(previousIndex);
                queuedIndexes.push(previousIndex);
            }
        }

        const chapterAnchorIndexes = this.chapters
            .filter((chapter) => this.isChapterAvailable(chapter))
            .map((chapter) => this.scenes.findIndex((scene) => scene.slideNumber === chapter.firstSlide))
            .filter((sceneIndex) => sceneIndex >= 0);

        this.pinnedImageUrls = new Set(
            [...windowIndexes, ...chapterAnchorIndexes].map((sceneIndex) => this.scenes[sceneIndex].image),
        );

        const queuedUrls = new Set();
        for (const sceneIndex of [...queuedIndexes, ...chapterAnchorIndexes]) {
            const src = this.scenes[sceneIndex].image;
            if (sceneIndex === index || queuedUrls.has(src)) continue;
            queuedUrls.add(src);
            this.queueImagePreload(src);
        }

        this.evictImageCache();
    }

    queueImagePreload(src) {
        if (this.imageCache.has(src) || this.queuedImageUrls.has(src)) return;
        this.queuedImageUrls.add(src);
        this.preloadQueue.push(src);
        this.drainPreloadQueue();
    }

    drainPreloadQueue() {
        while (this.activeBackgroundLoads < this.maxBackgroundLoads && this.preloadQueue.length) {
            const src = this.preloadQueue.shift();
            this.queuedImageUrls.delete(src);
            this.activeBackgroundLoads += 1;
            this.loadImage(src, { priority: 'low' })
                .catch(() => {})
                .finally(() => {
                    this.activeBackgroundLoads -= 1;
                    this.drainPreloadQueue();
                });
        }
    }

    promoteImage(src) {
        const queuedIndex = this.preloadQueue.indexOf(src);
        if (queuedIndex >= 0) this.preloadQueue.splice(queuedIndex, 1);
        this.queuedImageUrls.delete(src);
        return this.loadImage(src, { priority: 'high' });
    }

    loadImage(src, { priority = 'low' } = {}) {
        const existing = this.imageCache.get(src);
        if (existing) {
            existing.lastUsed = ++this.imageCacheClock;
            if (priority === 'high') existing.image.fetchPriority = 'high';
            return existing.promise;
        }

        const image = new Image();
        image.decoding = 'async';
        image.fetchPriority = priority;
        const entry = {
            image,
            status: 'loading',
            lastUsed: ++this.imageCacheClock,
            promise: null,
        };

        entry.promise = new Promise((resolve, reject) => {
            let finishing = false;

            const fail = (error) => {
                if (entry.status !== 'loading') return;
                entry.status = 'failed';
                image.onload = null;
                image.onerror = null;
                if (this.imageCache.get(src) === entry) this.imageCache.delete(src);
                reject(error instanceof Error ? error : new Error(`Could not load image: ${src}`));
            };

            const finish = async () => {
                if (finishing || entry.status !== 'loading') return;
                finishing = true;
                try {
                    if (typeof image.decode === 'function') await image.decode();
                } catch (error) {
                    if (!image.complete || !image.naturalWidth) {
                        fail(error);
                        return;
                    }
                }
                entry.status = 'ready';
                image.onload = null;
                image.onerror = null;
                entry.lastUsed = ++this.imageCacheClock;
                this.evictImageCache();
                resolve(image);
            };

            image.onload = finish;
            image.onerror = fail;
            image.src = src;
            if (image.complete && image.naturalWidth) Promise.resolve().then(finish);
        });

        this.imageCache.set(src, entry);
        return entry.promise;
    }

    evictImageCache() {
        while (this.imageCache.size > this.maxCachedImages) {
            const candidate = [...this.imageCache.entries()]
                .filter(([src, entry]) => entry.status === 'ready' && !this.pinnedImageUrls.has(src))
                .sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
            if (!candidate) return;
            this.imageCache.delete(candidate[0]);
        }
    }

    clearPanClasses() {
        this.image.classList.remove(
            'pan-top-to-bottom',
            'pan-bottom-to-top',
            'pan-left-to-right',
            'pan-right-to-left',
            'pan-vertical',
            'pan-horizontal',
        );
        this.image.style.removeProperty('--pan-half');
    }

    isVerticalPan(panAnimation) {
        return panAnimation === 'top-to-bottom' || panAnimation === 'bottom-to-top';
    }

    // How far the pan travels depends on the image's aspect ratio, which CSS cannot
    // see, so the distance is measured here and handed to the keyframes as --pan-half.
    // The orientation class must already be applied and the image loaded, otherwise
    // offsetHeight/offsetWidth still describe the unsized element.
    startPan(scene) {
        const index = this.currentSceneIndex;
        const vertical = this.isVerticalPan(scene.panAnimation);
        this.image.classList.add(vertical ? 'pan-vertical' : 'pan-horizontal');

        const begin = () => {
            if (this.currentSceneIndex !== index) return;
            this.measurePan(vertical);
            this.image.classList.add(`pan-${scene.panAnimation}`);
            this.image.style.animationPlayState = this.audio.paused ? 'paused' : 'running';
        };

        if (this.image.complete && this.image.naturalWidth) {
            begin();
        } else {
            this.image.addEventListener('load', begin, { once: true });
        }
    }

    measurePan(vertical) {
        const frame = this.image.parentElement;
        const overflow = vertical
            ? this.image.offsetHeight - frame.clientHeight
            : this.image.offsetWidth - frame.clientWidth;
        this.image.style.setProperty('--pan-half', `${Math.max(0, overflow) / 2}px`);
    }

    handleResize() {
        const scene = this.scenes[this.currentSceneIndex];
        if (!scene || !scene.panAnimation) return;
        if (!this.image.classList.contains(`pan-${scene.panAnimation}`)) return;
        this.measurePan(this.isVerticalPan(scene.panAnimation));
    }

    renderScene(index) {
        this.currentSceneIndex = index;
        this.pendingSceneIndex = null;
        const scene = this.scenes[index];

        this.preloadAround(index);
        this.clearPanClasses();
        void this.image.offsetWidth;

        if (scene.panAnimation) {
            this.startPan(scene);
        }

        this.textContainer.scrollTop = 0;
        this.textContainer.innerHTML = scene.text;

        this.indicator.innerText = `${this.getChapterTitle(scene)} - Scene ${index + 1} / ${this.scenes.length}`;
        this.updateChapterNav(scene);

        if (window.location.hash !== `#slide-${index + 1}`) {
            history.replaceState(null, null, `#slide-${index + 1}`);
        }

        const progressPercentage = ((index + 1) / this.scenes.length) * 100;
        this.progressBar.style.width = `${progressPercentage}%`;
        this.updateNavigationButtons();
    }

    async renderEndCard() {
        const token = ++this.transitionToken;
        this.pendingSceneIndex = null;
        this.audio.pause();
        this.pendingSeek = null;

        const endSceneIndex = this.endCardSceneIndex >= 0 ? this.endCardSceneIndex : this.scenes.length - 1;
        const endScene = this.scenes[endSceneIndex];
        const fadePromise = this.fadeOutFrame(true, token);
        const imagePromise = endScene
            ? this.promoteImage(endScene.image).then(
                () => ({ error: null }),
                (error) => ({ error }),
            )
            : Promise.resolve({ error: null });

        await fadePromise;
        if (token !== this.transitionToken) return;

        if (endScene) {
            let imageSrc = endScene.image;
            const imageResult = await imagePromise;
            if (imageResult.error) {
                console.warn(`End-card image failed to load: ${imageSrc}`, imageResult.error);
                imageSrc = this.placeholderImageSrc;
                try {
                    await this.promoteImage(imageSrc);
                } catch (placeholderError) {
                    console.warn('End-card placeholder failed to load.', placeholderError);
                }
            }
            if (token !== this.transitionToken) return;

            try {
                await this.setDisplayImage(imageSrc);
            } catch (error) {
                console.warn(`End-card image failed to decode: ${imageSrc}`, error);
                imageSrc = this.placeholderImageSrc;
                try {
                    await this.promoteImage(imageSrc);
                    if (token === this.transitionToken) await this.setDisplayImage(imageSrc);
                } catch (placeholderError) {
                    console.warn('End-card placeholder failed to display.', placeholderError);
                }
            }
            if (token !== this.transitionToken) return;
        }

        this.currentSceneIndex = endSceneIndex;
        this.clearPanClasses();
        this.image.style.animationPlayState = 'paused';

        this.textContainer.scrollTop = 0;
        this.textContainer.innerHTML = 'To be continued ...';
        this.indicator.innerText = 'To be continued';
        this.progressBar.style.width = '100%';
        this.updateChapterNav(null);

        if (window.location.hash !== '#to-be-continued') {
            history.replaceState(null, null, '#to-be-continued');
        }

        this.revealFrame();
        this.updateNavigationButtons();
    }

    ensureAudioSource(scene) {
        if (this.currentAudioSrc === scene.audioSrc) return;

        this.currentAudioSrc = scene.audioSrc;
        this.audio.src = scene.audioSrc;
        this.audio.load();
    }

    applyAudioAction(scene, action, token) {
        if (action === 'none') return;
        this.ensureAudioSource(scene);
        this.seekToScene(scene, {
            playAfterSeek: action === 'seek-and-play',
            token,
        });
    }

    playAudio() {
        this.audio.play().catch((error) => console.log('Autoplay prevented.', error));
    }

    seekToScene(scene, { playAfterSeek = false, token = this.transitionToken } = {}) {
        if (scene.syncStatus === 'unmatched') return;
        const targetTime = Math.max(0, scene.startTime);
        if (this.audio.readyState === 0) {
            this.pendingSeek = {
                time: targetTime,
                audioSrc: scene.audioSrc,
                playAfterSeek,
                token,
            };
            return;
        }
        if (token !== this.transitionToken) return;
        this.audio.currentTime = targetTime;
        this.pendingSeek = null;
        if (playAfterSeek) this.playAudio();
    }

    getChapterForScene(scene) {
        if (!scene) return null;
        return this.chapters.find((chapter) => chapter.id === scene.chapterId) || null;
    }

    getChapterTitle(scene) {
        return this.getChapterForScene(scene)?.title || 'Story';
    }

    updateChapterNav(scene) {
        if (!this.chapterNav) return;
        for (const button of this.chapterNav.querySelectorAll('.chapter-tab')) {
            button.classList.toggle('active', scene && button.dataset.chapterId === scene.chapterId);
        }
    }

    updateNavigationButtons() {
        const controlsDisabled = !this.audio.paused && !this.audio.ended;
        this.btnPrev.disabled = controlsDisabled;
        this.btnNext.disabled = controlsDisabled;
        this.btnPrev.setAttribute('aria-disabled', String(controlsDisabled));
        this.btnNext.setAttribute('aria-disabled', String(controlsDisabled));
    }

    goToNextScene() {
        if (!this.audio.paused && !this.audio.ended) return;

        const currentIndex = this.pendingSceneIndex !== null ? this.pendingSceneIndex : this.currentSceneIndex;
        if (currentIndex < this.scenes.length - 1) {
            if (!this.isSceneAvailable(this.scenes[currentIndex + 1])) {
                this.renderEndCard();
                return;
            }
            this.transitionToScene(currentIndex + 1, { smoothFade: true, audioAction: 'seek' });
        }
    }

    goToPrevScene() {
        if (!this.audio.paused && !this.audio.ended) return;

        const currentIndex = this.pendingSceneIndex !== null ? this.pendingSceneIndex : this.currentSceneIndex;
        if (currentIndex <= 0) {
            this.audio.currentTime = 0;
            return;
        }

        if (!this.isSceneAvailable(this.scenes[currentIndex])) {
            const previousAvailableIndex = this.findPreviousAvailableSceneIndex(currentIndex);
            if (previousAvailableIndex >= 0) {
                this.transitionToScene(previousAvailableIndex, { smoothFade: true, audioAction: 'seek' });
            }
            return;
        }

        const scene = this.scenes[currentIndex];
        if (scene.syncStatus !== 'unmatched' && this.audio.currentTime > scene.startTime + 2) {
            this.seekToScene(scene);
            return;
        }

        this.transitionToScene(currentIndex - 1, { smoothFade: true, audioAction: 'seek' });
    }

    isChapterAvailable(chapter) {
        return chapter && this.availableChapterIds.has(chapter.id);
    }

    isSceneAvailable(scene) {
        return scene && this.availableChapterIds.has(scene.chapterId);
    }

    findPreviousAvailableSceneIndex(startIndex) {
        for (let i = startIndex - 1; i >= 0; i--) {
            if (this.isSceneAvailable(this.scenes[i])) return i;
        }
        return -1;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new StoryComic();
});
