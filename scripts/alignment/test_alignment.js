#!/usr/bin/env node

const assert = require('assert');
const {
    alignScenesToWords,
    extractTranscriptWords,
    normalizeText,
    tokenize,
} = require('./alignment-core');

assert.strictEqual(
    normalizeText('The Troll Bridge<br><br>“Ahead,” said Bors &amp; Ivan.'),
    'the troll bridge ahead said bors and ivan',
);

assert.deepStrictEqual(
    tokenize('Dargon’s safety paramount.'),
    ["dargon's", 'safety', 'paramount'],
);

const transcriptWords = extractTranscriptWords({
    segments: [
        {
            words: [
                { word: 'Fair', start: 0, end: 0.3 },
                { word: 'indeed', start: 0.4, end: 0.8 },
                { word: 'are', start: 0.9, end: 1.0 },
                { word: 'its', start: 1.1, end: 1.2 },
                { word: 'pastures', start: 1.3, end: 1.8 },
                { word: 'Wise', start: 8, end: 8.2 },
                { word: 'are', start: 8.3, end: 8.4 },
                { word: 'its', start: 8.5, end: 8.6 },
                { word: 'laws', start: 8.7, end: 9.0 },
            ],
        },
    ],
});

const aligned = alignScenesToWords([
    { slideNumber: 1, startTime: 0, text: 'Fair indeed are its pastures.' },
    { slideNumber: 2, startTime: 20, text: 'Wise are its laws.' },
], transcriptWords, { duration: 20, largeDelta: 99 });

assert.strictEqual(aligned[0].startTime, 0);
assert.strictEqual(aligned[0].severity, 'ok');
assert.strictEqual(aligned[1].startTime, 8);
assert.strictEqual(aligned[1].severity, 'ok');

const internalAnchor = alignScenesToWords([
    { slideNumber: 1, startTime: 0, text: 'Missing title words with enough prefix tokens before the spoken phrase Wise are its laws.' },
], transcriptWords, { duration: 20, failureConfidence: 0.8 });

assert.strictEqual(internalAnchor[0].severity, 'failure');
assert.strictEqual(Number.isFinite(internalAnchor[0].startTime), false);
assert.match(internalAnchor[0].anchorTranscript, /Wise/);

const overDuration = alignScenesToWords([
    { slideNumber: 1, startTime: 30, text: 'Wise are its laws.' },
], transcriptWords, { duration: 7 });

assert.strictEqual(overDuration[0].severity, 'failure');
assert.match(overDuration[0].reason, /duration/);

console.log('alignment tests passed');
