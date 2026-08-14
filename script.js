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
        this.transitionTimeout = null;
        this.fadeTimeout = null;
        this.pendingSeekTime = null;
        this.availableChapterIds = new Set(['introduction', 'chapter-1', 'chapter-2', 'chapter-3', 'chapter-4']);
        this.endCardSceneIndex = this.scenes.findIndex((scene) => !this.isSceneAvailable(scene));
        this.fadeDurationMs = 800;
        this.fadeLeadSeconds = this.fadeDurationMs / 1000;

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

        this.transitionToScene(startIndex, { smoothFade: false, forceSeek: true });
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
                button.addEventListener('click', () => {
                    const firstSceneIndex = this.scenes.findIndex((scene) => scene.slideNumber === chapter.firstSlide);
                    if (firstSceneIndex >= 0) {
                        this.transitionToScene(firstSceneIndex, { smoothFade: true, forceSeek: true, autoPlay: true });
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
            this.transitionToScene(nextSceneIndex, { smoothFade: true, forceSeek: true, autoPlay: true });
        }
    }

    handleLoadedMetadata() {
        if (this.pendingSeekTime === null) return;
        this.audio.currentTime = this.pendingSeekTime;
        this.pendingSeekTime = null;
    }

    handleTimeUpdate() {
        if (this.currentSceneIndex < 0) return;

        const currentTime = this.audio.currentTime;
        const currentScene = this.scenes[this.currentSceneIndex];
        const nextScene = this.scenes[this.currentSceneIndex + 1];
        if (!nextScene || nextScene.audioSrc !== currentScene.audioSrc) return;
        if (!this.isSceneAvailable(nextScene)) return;
        if (nextScene.syncStatus === 'unmatched') return;

        if (currentTime >= nextScene.startTime - this.fadeLeadSeconds) {
            this.transitionToScene(this.currentSceneIndex + 1, {
                smoothFade: true,
                forceSeek: false,
                autoPlay: !this.audio.paused,
            });
        }
    }

    transitionToScene(index, options = {}) {
        const settings = {
            smoothFade: options.smoothFade !== false,
            forceSeek: options.forceSeek === true,
            autoPlay: options.autoPlay,
        };

        if (index < 0 || index >= this.scenes.length) return;
        if (!this.isSceneAvailable(this.scenes[index])) {
            this.renderEndCard();
            return;
        }
        if (this.pendingSceneIndex === index || (this.pendingSceneIndex === null && this.currentSceneIndex === index)) return;

        this.pendingSceneIndex = index;

        if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
        if (this.fadeTimeout) clearTimeout(this.fadeTimeout);

        const wasPlaying = !this.audio.paused;
        const shouldAutoPlay = settings.autoPlay !== undefined ? settings.autoPlay : wasPlaying;

        if (settings.smoothFade) {
            this.image.classList.add('fade-out');
            this.textContainer.classList.add('fade-out');

            this.transitionTimeout = setTimeout(() => {
                this.renderScene(index, { autoPlay: shouldAutoPlay, forceSeek: settings.forceSeek });
                this.fadeTimeout = setTimeout(() => {
                    this.image.classList.remove('fade-out');
                    this.textContainer.classList.remove('fade-out');
                }, 100);
            }, this.fadeDurationMs);
        } else {
            this.renderScene(index, { autoPlay: shouldAutoPlay, forceSeek: settings.forceSeek });
        }
    }

    preloadImages(startIndex, count = 3) {
        for (let i = startIndex + 1; i <= startIndex + count && i < this.scenes.length; i++) {
            const scene = this.scenes[i];
            if (!scene.preloadedImageObject) {
                scene.preloadedImageObject = new Image();
                scene.preloadedImageObject.src = scene.image;
            }
        }
    }

    renderScene(index, options = {}) {
        this.currentSceneIndex = index;
        this.pendingSceneIndex = null;
        const scene = this.scenes[index];

        this.preloadImages(index);
        this.ensureAudioSource(scene);

        if (options.forceSeek || this.shouldSeekToScene(scene)) {
            this.seekToScene(scene);
        }

        if (options.autoPlay) {
            this.audio.play().catch((error) => console.log("Autoplay prevented.", error));
        }

        this.image.src = scene.image;
        this.image.classList.remove('pan-top-to-bottom', 'pan-bottom-to-top', 'pan-left-to-right', 'pan-right-to-left');
        void this.image.offsetWidth;

        if (scene.panAnimation) {
            this.image.classList.add(`pan-${scene.panAnimation}`);
            this.image.style.objectPosition = '';
            this.image.style.animationPlayState = this.audio.paused ? 'paused' : 'running';
        } else {
            this.image.style.objectPosition = 'center';
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

    renderEndCard() {
        if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
        if (this.fadeTimeout) clearTimeout(this.fadeTimeout);

        this.pendingSceneIndex = null;
        this.currentSceneIndex = this.endCardSceneIndex >= 0 ? this.endCardSceneIndex : this.scenes.length - 1;
        this.audio.pause();
        this.pendingSeekTime = null;

        const endScene = this.scenes[this.currentSceneIndex];
        if (endScene) {
            this.image.src = endScene.image;
        }
        this.image.classList.remove('fade-out', 'pan-top-to-bottom', 'pan-bottom-to-top', 'pan-left-to-right', 'pan-right-to-left');
        this.image.style.objectPosition = 'center';
        this.image.style.animationPlayState = 'paused';

        this.textContainer.classList.remove('fade-out');
        this.textContainer.scrollTop = 0;
        this.textContainer.innerHTML = 'To be continued ...';
        this.indicator.innerText = 'To be continued';
        this.progressBar.style.width = '100%';
        this.updateChapterNav(null);

        if (window.location.hash !== '#to-be-continued') {
            history.replaceState(null, null, '#to-be-continued');
        }

        this.updateNavigationButtons();
    }

    ensureAudioSource(scene) {
        if (this.currentAudioSrc === scene.audioSrc) return;

        this.currentAudioSrc = scene.audioSrc;
        this.audio.src = scene.audioSrc;
        this.audio.load();
    }

    shouldSeekToScene(scene) {
        if (scene.syncStatus === 'unmatched') return false;
        return this.audio.currentTime < scene.startTime || this.audio.currentTime > scene.startTime + 2;
    }

    seekToScene(scene) {
        if (scene.syncStatus === 'unmatched') return;
        const targetTime = Math.max(0, scene.startTime);
        if (this.audio.readyState === 0) {
            this.pendingSeekTime = targetTime;
            return;
        }
        this.audio.currentTime = targetTime;
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
            this.transitionToScene(currentIndex + 1, { smoothFade: true, forceSeek: true, autoPlay: !this.audio.paused });
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
                this.transitionToScene(previousAvailableIndex, { smoothFade: true, forceSeek: true, autoPlay: false });
            }
            return;
        }

        const scene = this.scenes[currentIndex];
        if (scene.syncStatus !== 'unmatched' && this.audio.currentTime > scene.startTime + 2) {
            this.seekToScene(scene);
            return;
        }

        this.transitionToScene(currentIndex - 1, { smoothFade: true, forceSeek: true, autoPlay: !this.audio.paused });
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
