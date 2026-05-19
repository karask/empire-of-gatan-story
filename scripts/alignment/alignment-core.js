const TAG_RE = /<br\s*\/?>/gi;

function normalizeText(text) {
    return String(text)
        .replace(TAG_RE, ' ')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, ' and ')
        .toLowerCase()
        .replace(/[^a-z0-9']+/g, ' ')
        .replace(/(^|\s)'|'(\s|$)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(text) {
    const normalized = normalizeText(text);
    return normalized ? normalized.split(' ') : [];
}

function extractTranscriptWords(transcript) {
    const rawWords = [];

    if (Array.isArray(transcript.word_segments)) {
        rawWords.push(...transcript.word_segments);
    } else if (Array.isArray(transcript.segments)) {
        for (const segment of transcript.segments) {
            if (Array.isArray(segment.words)) {
                rawWords.push(...segment.words);
            }
        }
    }

    const words = rawWords
        .filter((word) => word && word.word != null && word.start != null)
        .map((word) => ({
            token: tokenize(word.word)[0],
            start: Number(word.start),
            end: word.end == null ? Number(word.start) : Number(word.end),
            score: word.score == null ? 1 : Number(word.score),
            raw: word.word,
        }))
        .filter((word) => word.token && Number.isFinite(word.start));

    if (!words.length) {
        throw new Error('Transcript did not contain word timestamps.');
    }

    words.sort((a, b) => a.start - b.start);
    return words;
}

function alignScenesToWords(scenes, transcriptWords, options = {}) {
    const duration = options.duration || Infinity;
    const searchBack = options.searchBack || 30;
    const searchAhead = options.searchAhead || 500;
    const minProbeWords = options.minProbeWords || 6;
    const maxProbeWords = options.maxProbeWords || 18;
    const maxProbeOffset = options.maxProbeOffset || 30;
    const failureConfidence = options.failureConfidence || 0.4;
    const lowConfidence = options.lowConfidence || 0.55;
    const largeDelta = options.largeDelta || 20;

    let cursor = 0;
    let previousStart = -Infinity;

    return scenes.map((scene, index) => {
        const sceneTokens = tokenize(scene.text);
        const oldStartTime = Number(scene.startTime);
        const base = {
            slideNumber: scene.slideNumber || index + 1,
            oldStartTime,
            text: scene.text,
            startTime: NaN,
            delta: NaN,
            confidence: 0,
            severity: 'failure',
            reason: '',
        };

        if (!sceneTokens.length) {
            return { ...base, reason: 'Scene has no alignable text.' };
        }

        const match = findPrefixStart(sceneTokens, transcriptWords, cursor, {
            searchBack,
            searchAhead,
            minProbeWords,
            maxProbeWords,
        });
        const anchor = findInternalAnchor(sceneTokens, transcriptWords, cursor, {
            searchBack,
            searchAhead,
            minProbeWords,
            maxProbeWords,
            maxProbeOffset,
        });

        if (!match || !transcriptWords[match.index]) {
            return {
                ...base,
                reason: 'Could not find matching transcript words.',
                anchorConfidence: anchor ? anchor.confidence : 0,
                anchorTranscript: formatTranscriptSnippet(transcriptWords, anchor),
            };
        }

        const startTime = transcriptWords[match.index].start;
        const delta = startTime - oldStartTime;
        const confidence = match.confidence;
        let severity = 'ok';
        let reason = 'ok';

        if (confidence < failureConfidence) {
            severity = 'failure';
            reason = 'Word match confidence is too low; scene may be absent from the audio.';
        } else if (startTime <= previousStart) {
            severity = 'failure';
            reason = 'Timestamp is not strictly increasing.';
        } else if (startTime > duration) {
            severity = 'failure';
            reason = 'Timestamp exceeds audio duration.';
        } else if (confidence < lowConfidence) {
            severity = 'warning';
            reason = 'Low transcript match confidence.';
        } else if (Math.abs(delta) > largeDelta) {
            severity = 'warning';
            reason = 'Large change from existing timing.';
        }

        const result = {
            ...base,
            startTime: severity === 'failure' ? NaN : startTime,
            delta: severity === 'failure' ? NaN : delta,
            confidence,
            severity,
            reason,
            transcriptIndex: match.index,
            consumed: match.consumed,
            tokenOffset: 0,
            matchedTranscript: formatTranscriptSnippet(transcriptWords, match),
            anchorConfidence: anchor ? anchor.confidence : 0,
            anchorTranscript: formatTranscriptSnippet(transcriptWords, anchor),
        };

        if (severity !== 'failure') {
            cursor = Math.max(match.index + Math.max(sceneTokens.length, match.consumed), cursor + 1);
            previousStart = startTime;
        }

        return result;
    });
}

function findPrefixStart(sceneTokens, transcriptWords, cursor, options) {
    const start = Math.max(0, cursor - options.searchBack);
    const end = Math.min(transcriptWords.length - 1, cursor + options.searchAhead);
    const probeSize = Math.min(
        Math.max(options.minProbeWords, Math.ceil(sceneTokens.length * 0.35)),
        options.maxProbeWords,
        sceneTokens.length,
    );
    const probe = sceneTokens.slice(0, probeSize);
    return findBestProbe(probe, transcriptWords, start, end, 0);
}

function findInternalAnchor(sceneTokens, transcriptWords, cursor, options) {
    const start = Math.max(0, cursor - options.searchBack);
    const end = Math.min(transcriptWords.length - 1, cursor + options.searchAhead);
    let best = null;
    const maxOffset = Math.min(options.maxProbeOffset, Math.max(0, sceneTokens.length - options.minProbeWords));

    for (let tokenOffset = options.minProbeWords; tokenOffset <= maxOffset; tokenOffset += options.minProbeWords) {
        const remaining = sceneTokens.length - tokenOffset;
        const probeSize = Math.min(
            Math.max(options.minProbeWords, Math.ceil(remaining * 0.35)),
            options.maxProbeWords,
            remaining,
        );
        const probe = sceneTokens.slice(tokenOffset, tokenOffset + probeSize);
        const match = findBestProbe(probe, transcriptWords, start, end, tokenOffset);
        if (!best || (match && match.confidence > best.confidence)) {
            best = match;
        }
    }

    return best;
}

function findBestProbe(probe, transcriptWords, start, end, tokenOffset) {
    let best = null;
    for (let i = start; i <= end; i++) {
        const score = scoreProbe(probe, transcriptWords, i);
        const confidence = score.confidence - tokenOffset * 0.002;
        if (!best || confidence > best.confidence) {
            best = {
                index: i,
                confidence,
                rawConfidence: score.confidence,
                consumed: score.consumed,
                tokenOffset,
            };
        }
    }
    return best;
}

function scoreProbe(probe, transcriptWords, startIndex) {
    let transcriptIndex = startIndex;
    let matches = 0;
    let misses = 0;
    const maxSkips = 8;

    for (const token of probe) {
        let foundAt = -1;
        for (let skip = 0; skip <= maxSkips; skip++) {
            const candidate = transcriptWords[transcriptIndex + skip];
            if (candidate && tokensEqual(token, candidate.token)) {
                foundAt = transcriptIndex + skip;
                break;
            }
        }

        if (foundAt >= 0) {
            matches += 1;
            misses += foundAt - transcriptIndex;
            transcriptIndex = foundAt + 1;
        } else {
            misses += 1;
            transcriptIndex += 1;
        }
    }

    const confidence = matches / (matches + misses || 1);
    return { confidence, consumed: transcriptIndex - startIndex };
}

function tokensEqual(a, b) {
    const normalizedA = normalizeNumberToken(a);
    const normalizedB = normalizeNumberToken(b);
    if (normalizedA === normalizedB) return true;
    if (a === b) return true;
    return stripPossessive(a) === stripPossessive(b);
}

function normalizeNumberToken(token) {
    const numbers = {
        one: '1',
        two: '2',
        three: '3',
        four: '4',
        five: '5',
        six: '6',
        seven: '7',
        eight: '8',
        nine: '9',
        ten: '10',
    };
    return numbers[token] || token;
}

function stripPossessive(token) {
    return token.replace(/'s$/, '');
}

function formatTranscriptSnippet(transcriptWords, match) {
    if (!match || !transcriptWords[match.index]) return '';
    return transcriptWords
        .slice(match.index, match.index + Math.min(12, Math.max(1, match.consumed)))
        .map((word) => word.raw)
        .join(' ');
}

module.exports = {
    alignScenesToWords,
    extractTranscriptWords,
    normalizeText,
    tokenize,
};
