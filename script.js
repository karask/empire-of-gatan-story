class StoryComic {
    constructor() {
        this.audio = document.getElementById('story-audio');
        this.image = document.getElementById('scene-image');
        this.textContainer = document.getElementById('scene-text');
        this.indicator = document.getElementById('scene-indicator');
        this.progressBar = document.getElementById('progress-bar-fill');
        this.btnPrev = document.getElementById('btn-prev');
        this.btnNext = document.getElementById('btn-next');

        this.currentSceneIndex = -1;
        this.scenes = window.storyScenes || [];
        this.currentAudioSrc = "";
        // Keep track of our virtual "timeline" time, useful for silent segments.
        this.virtualTimer = null;
        this.pendingSceneIndex = null;
        this.transitionTimeout = null;
        this.fadeTimeout = null;

        this.init();
    }

    init() {
        if (this.scenes.length === 0) {
            this.textContainer.innerText = "Error: Scene data not found.";
            return;
        }

        // Setup event listeners
        this.audio.addEventListener('timeupdate', () => this.handleTimeUpdate());
        this.audio.addEventListener('ended', () => this.handleAudioEnded());
        this.audio.addEventListener('play', () => this.handleAudioPlay());
        this.audio.addEventListener('pause', () => this.handleAudioPause());
        this.btnNext.addEventListener('click', () => this.goToNextScene());
        this.btnPrev.addEventListener('click', () => this.goToPrevScene());

        // Check URL for a specific slide number (e.g. #slide-5 or #5)
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

        // Initialize requested scene silently.
        this.transitionToScene(startIndex, false);
    }

    handleAudioPlay() {
        this.image.style.animationPlayState = 'running';
        const scene = this.scenes[this.currentSceneIndex];
        // If we are playing a "blank" track scene, start the virtual timer
        if (scene.endTime) {
            this.startVirtualTimer();
        }
    }

    handleAudioPause() {
        this.image.style.animationPlayState = 'paused';
        this.stopVirtualTimer();
    }

    handleAudioEnded() {
        const scene = this.scenes[this.currentSceneIndex];
        // If the audio track itself actually finishes, go next.
        if (this.currentSceneIndex < this.scenes.length - 1 && !scene.endTime) {
            this.goToNextScene();
        }
    }

    startVirtualTimer() {
        this.stopVirtualTimer();
        this.virtualTimer = setInterval(() => {
            const scene = this.scenes[this.currentSceneIndex];
            if (scene.endTime && this.audio.currentTime >= scene.endTime) {
                this.goToNextScene();
            }
        }, 100);
    }

    stopVirtualTimer() {
        if (this.virtualTimer) {
            clearInterval(this.virtualTimer);
            this.virtualTimer = null;
        }
    }

    handleTimeUpdate() {
        const currentTime = this.audio.currentTime;
        const currentScene = this.scenes[this.currentSceneIndex];

        // Ensure we don't accidentally skip to a different audio file's timestamp
        let nextSceneIndex = this.currentSceneIndex;

        // If we are in the main story track
        if (!currentScene.endTime && this.currentSceneIndex < this.scenes.length - 1) {
            const nextScene = this.scenes[this.currentSceneIndex + 1];
            // If the next scene has the same audiotrack and we passed its trigger time
            if (nextScene.audioSrc === currentScene.audioSrc && currentTime >= nextScene.startTime) {
                nextSceneIndex = this.currentSceneIndex + 1;
            }
        }

        if (nextSceneIndex !== this.currentSceneIndex) {
            this.transitionToScene(nextSceneIndex);
        }
    }

    transitionToScene(index, smoothFade = true) {
        if (index < 0 || index >= this.scenes.length) return;
        if (this.pendingSceneIndex === index || (this.pendingSceneIndex === null && this.currentSceneIndex === index)) return;

        this.pendingSceneIndex = index;

        if (this.transitionTimeout) clearTimeout(this.transitionTimeout);
        if (this.fadeTimeout) clearTimeout(this.fadeTimeout);

        const previousAudioState = !this.audio.paused;

        if (smoothFade) {
            this.image.classList.add('fade-out');
            this.textContainer.classList.add('fade-out');

            this.transitionTimeout = setTimeout(() => {
                this.renderScene(index, previousAudioState);
                this.fadeTimeout = setTimeout(() => {
                    this.image.classList.remove('fade-out');
                    this.textContainer.classList.remove('fade-out');
                }, 100); // Small buffer before fading back in
            }, 800); // Give it enough time to fade out (matches CSS)
        } else {
            this.renderScene(index, previousAudioState);
        }
    }

    renderScene(index, autoPlay = false) {
        this.currentSceneIndex = index;
        this.pendingSceneIndex = null;
        const scene = this.scenes[index];

        // Check if we need to swap audio sources
        if (this.currentAudioSrc !== scene.audioSrc) {
            this.currentAudioSrc = scene.audioSrc;

            // To prevent errors when swapping audio sources quickly, verify src changed.
            if (!this.audio.src.includes(scene.audioSrc)) {
                this.audio.src = scene.audioSrc;
                this.audio.load();
            }
        }

        // Set the time ONLY if we aren't already naturally progressing through the current track
        // to prevent stutters. Exception: The start of a timeline clip.
        if (this.audio.currentTime < scene.startTime || this.audio.currentTime > (scene.startTime + 2) || scene.endTime) {
            this.audio.currentTime = scene.startTime;
        }

        if (autoPlay) {
            this.audio.play().catch(e => console.log("Autoplay prevented.", e));
        }

        // Update content
        this.image.src = scene.image;
        // Handle image alignment and panning positioning
        this.image.classList.remove('pan-top-to-bottom');
        void this.image.offsetWidth; // Trigger DOM reflow to restart animations cleanly

        if (scene.panAnimation) {
            this.image.classList.add(`pan-${scene.panAnimation}`);
            this.image.style.objectPosition = ''; // Let animation handle position
            this.image.style.animationPlayState = this.audio.paused ? 'paused' : 'running';
        } else if (scene.imagePosition) {
            this.image.style.objectPosition = scene.imagePosition;
        } else {
            this.image.style.objectPosition = 'center'; // Default
        }

        if (scene.mirrorImage) {
            this.image.style.transform = 'scaleX(-1)';
        } else {
            this.image.style.transform = '';
        }

        this.textContainer.scrollTop = 0; // Reset scroll position to top
        this.textContainer.innerHTML = scene.text;

        // Update UI info
        this.indicator.innerText = `Scene ${index + 1} / ${this.scenes.length}`;

        // Update URL hash without flooding history state ONLY if it's currently different
        if (window.location.hash !== `#slide-${index + 1}`) {
            history.replaceState(null, null, `#slide-${index + 1}`);
        }

        // Update progress bar
        const progressPercentage = ((index + 1) / this.scenes.length) * 100;
        this.progressBar.style.width = `${progressPercentage}%`;
    }

    goToNextScene() {
        let currentIndex = this.pendingSceneIndex !== null ? this.pendingSceneIndex : this.currentSceneIndex;
        if (currentIndex < this.scenes.length - 1) {
            this.transitionToScene(currentIndex + 1);
        }
    }

    goToPrevScene() {
        let currentIndex = this.pendingSceneIndex !== null ? this.pendingSceneIndex : this.currentSceneIndex;
        if (currentIndex > 0) {
            // If we're midway through a scene (more than 2 seconds), restart it first
            const scene = this.scenes[currentIndex];
            if (this.audio.currentTime > scene.startTime + 2 && !scene.endTime) {
                this.audio.currentTime = scene.startTime;
            } else {
                this.transitionToScene(currentIndex - 1);
            }
        } else {
            this.audio.currentTime = 0;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new StoryComic();
});
