#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const {
    alignScenesToWords,
    extractTranscriptWords,
    normalizeText,
} = require('./alignment-core');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_DATA = path.join(ROOT, 'data.js');
const DEFAULT_AUDIO = path.join(ROOT, 'TheChroniclesOfGatan-Audio.mp3');
const DEFAULT_OUT = path.join(ROOT, '.alignment');

function parseArgs(argv) {
    const args = {
        data: DEFAULT_DATA,
        audio: DEFAULT_AUDIO,
        transcript: null,
        out: DEFAULT_OUT,
        apply: false,
        applyValid: false,
        preserveThrough: 0,
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--apply') {
            args.apply = true;
        } else if (arg === '--apply-valid') {
            args.applyValid = true;
        } else if (arg === '--data') {
            args.data = path.resolve(argv[++i]);
        } else if (arg === '--audio') {
            args.audio = path.resolve(argv[++i]);
        } else if (arg === '--transcript') {
            args.transcript = path.resolve(argv[++i]);
        } else if (arg === '--out') {
            args.out = path.resolve(argv[++i]);
        } else if (arg === '--preserve-through') {
            args.preserveThrough = parseInt(argv[++i], 10);
            if (!Number.isInteger(args.preserveThrough) || args.preserveThrough < 0) {
                throw new Error('--preserve-through must be a non-negative integer.');
            }
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!args.transcript) {
        throw new Error('Missing --transcript path. Generate it with WhisperX first.');
    }

    return args;
}

function printHelp() {
    console.log(`Usage:
  node scripts/alignment/align-scenes.js --transcript .alignment/TheChroniclesOfGatan-Audio.json
  node scripts/alignment/align-scenes.js --transcript .alignment/TheChroniclesOfGatan-Audio.json --apply

Options:
  --transcript <file>  WhisperX JSON transcript with word timestamps
  --data <file>        Scene data file, defaults to data.js
  --audio <file>       Audio file used for duration validation
  --out <dir>          Output directory, defaults to .alignment
  --preserve-through N Keep slides 1..N at their existing startTime values
  --apply              Rewrite all startTime values only when there are no failures
  --apply-valid        Rewrite non-failed startTime values and leave failed scenes unchanged`);
}

function loadScenes(dataPath) {
    const source = fs.readFileSync(dataPath, 'utf8');
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: dataPath });
    if (!Array.isArray(context.window.storyScenes)) {
        throw new Error(`${dataPath} did not define window.storyScenes`);
    }
    return { source, scenes: context.window.storyScenes };
}

function getAudioDuration(audioPath) {
    const output = execFileSync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        audioPath,
    ], { encoding: 'utf8' }).trim();

    const duration = Number(output);
    if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error(`Could not read audio duration from ${audioPath}`);
    }
    return duration;
}

function buildReport({ scenes, results, duration, transcriptWords }) {
    const failures = results.filter((r) => r.severity === 'failure');
    const warnings = results.filter((r) => r.severity === 'warning');
    const lines = [];

    lines.push('# Scene Alignment Report');
    lines.push('');
    lines.push(`Audio duration: ${duration.toFixed(3)}s`);
    lines.push(`Scenes: ${scenes.length}`);
    lines.push(`Transcript words: ${transcriptWords.length}`);
    lines.push(`Failures: ${failures.length}`);
    lines.push(`Warnings: ${warnings.length}`);
    lines.push('');
    lines.push('| Slide | Old | Proposed | Delta | Confidence | Status | Scene Text | Prefix Transcript | Internal Anchor |');
    lines.push('| ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |');

    for (const result of results) {
        const oldTime = formatSeconds(result.oldStartTime);
        const proposed = Number.isFinite(result.startTime) ? formatSeconds(result.startTime) : 'n/a';
        const delta = Number.isFinite(result.delta) ? `${result.delta >= 0 ? '+' : ''}${result.delta.toFixed(2)}s` : 'n/a';
        const confidence = Number.isFinite(result.confidence) ? result.confidence.toFixed(2) : 'n/a';
        const excerpt = normalizeText(result.text).split(' ').slice(0, 12).join(' ');
        const matchedTranscript = result.matchedTranscript || '';
        const anchor = result.anchorTranscript ? `${result.anchorConfidence.toFixed(2)}: ${result.anchorTranscript}` : '';
        lines.push(`| ${result.slideNumber} | ${oldTime} | ${proposed} | ${delta} | ${confidence} | ${result.severity} | ${escapeCell(excerpt)} | ${escapeCell(matchedTranscript)} | ${escapeCell(anchor)} |`);
    }

    if (failures.length) {
        lines.push('');
        lines.push('## Failures');
        for (const failure of failures) {
            lines.push(`- Slide ${failure.slideNumber}: ${failure.reason}`);
        }
    }

    if (warnings.length) {
        lines.push('');
        lines.push('## Warnings');
        for (const warning of warnings) {
            lines.push(`- Slide ${warning.slideNumber}: ${warning.reason}`);
        }
    }

    return lines.join('\n') + '\n';
}

function formatSeconds(value) {
    return `${Number(value).toFixed(2)}s`;
}

function escapeCell(value) {
    return String(value).replace(/\|/g, '\\|');
}

function writeTimings(outDir, results) {
    const timings = results.map((result) => ({
        slideNumber: result.slideNumber,
        startTime: Number.isFinite(result.startTime) ? roundTime(result.startTime) : null,
        oldStartTime: result.oldStartTime,
        confidence: Number(result.confidence.toFixed(3)),
        severity: result.severity,
        reason: result.reason,
        matchedTranscript: result.matchedTranscript,
        anchorConfidence: Number(result.anchorConfidence.toFixed(3)),
        anchorTranscript: result.anchorTranscript,
    }));
    fs.writeFileSync(path.join(outDir, 'timings.json'), `${JSON.stringify(timings, null, 2)}\n`);
}

function applyTimings(dataPath, source, results, { allowFailures = false } = {}) {
    const failures = results.filter((result) => result.severity === 'failure');
    if (failures.length && !allowFailures) {
        throw new Error(`Refusing to apply timings with ${failures.length} alignment failures. Use --apply-valid to update only non-failed scenes.`);
    }

    let index = 0;
    const updated = source.replace(/startTime:\s*([0-9]+(?:\.[0-9]+)?)/g, () => {
        if (index >= results.length) {
            throw new Error('Found more startTime fields than scenes.');
        }
        const result = results[index++];
        if (!Number.isFinite(result.startTime)) {
            return `startTime: ${formatTimeLiteral(result.oldStartTime)}`;
        }
        return `startTime: ${formatTimeLiteral(roundTime(result.startTime))}`;
    });

    if (index !== results.length) {
        throw new Error(`Found ${index} startTime fields but expected ${results.length}.`);
    }

    fs.writeFileSync(dataPath, updated);
}

function roundTime(value) {
    return Math.round(value * 100) / 100;
}

function formatTimeLiteral(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const { source, scenes } = loadScenes(args.data);
    const transcript = JSON.parse(fs.readFileSync(args.transcript, 'utf8'));
    const transcriptWords = extractTranscriptWords(transcript);
    const duration = getAudioDuration(args.audio);
    const results = preserveLeadingTimings(
        alignScenesToWords(scenes, transcriptWords, { duration }),
        args.preserveThrough,
    );

    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, 'alignment-report.md'), buildReport({
        scenes,
        results,
        duration,
        transcriptWords,
    }));
    writeTimings(args.out, results);

    const failures = results.filter((result) => result.severity === 'failure').length;
    const warnings = results.filter((result) => result.severity === 'warning').length;
    console.log(`Wrote ${path.relative(ROOT, path.join(args.out, 'alignment-report.md'))}`);
    console.log(`Wrote ${path.relative(ROOT, path.join(args.out, 'timings.json'))}`);
    console.log(`Alignment completed with ${failures} failures and ${warnings} warnings.`);

    if (args.apply || args.applyValid) {
        const resultsToApply = args.applyValid ? keepInvalidOrUnsafeOld(results) : enforceTimelineOrder(results);
        applyTimings(args.data, source, resultsToApply, { allowFailures: args.applyValid });
        if (args.applyValid) {
            const applied = resultsToApply.filter((result) => result.applyAction === 'applied').length;
            const skipped = resultsToApply.filter((result) => result.applyAction === 'kept-old').length;
            console.log(`Updated ${path.relative(ROOT, args.data)} startTime values for ${applied} scenes; kept old values for ${skipped} n/a or timeline-unsafe scenes.`);
        } else {
            console.log(`Updated ${path.relative(ROOT, args.data)} startTime values.`);
        }
    } else {
        console.log('Dry run only. Re-run with --apply after reviewing the report, or --apply-valid to leave failed scenes unchanged.');
    }
}

function preserveLeadingTimings(results, preserveThrough) {
    if (!preserveThrough) return results;
    return results.map((result) => {
        if (result.slideNumber > preserveThrough) return result;
        return {
            ...result,
            startTime: result.oldStartTime,
            delta: 0,
            severity: 'preserved',
            reason: `Preserved by --preserve-through ${preserveThrough}.`,
        };
    });
}

function enforceTimelineOrder(results) {
    let previousStart = -Infinity;
    return results.map((result) => {
        if (!Number.isFinite(result.startTime)) return result;
        if (result.startTime <= previousStart) {
            return {
                ...result,
                startTime: NaN,
                delta: NaN,
                severity: 'failure',
                reason: `Timestamp would not be strictly increasing after ${previousStart.toFixed(2)}s.`,
            };
        }
        previousStart = result.startTime;
        return result;
    });
}

function keepInvalidOrUnsafeOld(results) {
    let previousEffectiveStart = -Infinity;
    return results.map((result) => {
        const proposedStart = result.startTime;
        const oldStart = result.oldStartTime;
        if (Number.isFinite(proposedStart) && proposedStart > previousEffectiveStart) {
            previousEffectiveStart = proposedStart;
            return {
                ...result,
                applyAction: 'applied',
            };
        }

        const previousBeforeFallback = previousEffectiveStart;
        if (oldStart <= previousEffectiveStart) {
            throw new Error(`Cannot keep old timing for slide ${result.slideNumber}; old ${oldStart.toFixed(2)}s would not follow ${previousEffectiveStart.toFixed(2)}s.`);
        }

        const reason = Number.isFinite(proposedStart)
            ? `Kept old timing because proposed ${proposedStart.toFixed(2)}s would not follow ${previousBeforeFallback.toFixed(2)}s safely.`
            : 'Kept old timing because proposed timing is n/a.';
        previousEffectiveStart = oldStart;

        return {
            ...result,
            startTime: NaN,
            delta: NaN,
            applyAction: 'kept-old',
            applyReason: reason,
        };
    });
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}
