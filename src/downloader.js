import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
    DOWNLOAD_DIR,
    YTDLP_BIN,
    resolveFormat,
    networkArgs,
} from "./config.js";
import { createJob, getJob } from "./jobs.js";

const YTDLP_NOT_FOUND = "yt-dlp was not found. Install it (e.g. `winget install yt-dlp` or `pip install yt-dlp`) and restart the server.";

const PROGRESS_PATTERN = /\[download\]\s+([\d.]+)%/;

// Force UTF-8 output from yt-dlp / Python so Windows error text isn't garbled (the "���" in the UI).
const SPAWN_OPTS = {
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1"
    },
    windowsHide: true,
};

// Common args: suppress the "older than 90 days" warning, add retries / timeouts, optional proxy / cookies.
const baseArgs = () => ["--no-warnings", "--encoding", "utf-8", ...networkArgs()];

// Keep only the meaningful "ERROR:" lines and translate common causes into a hint.
function explainError(stderr) {
    const lines = String(stderr).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const errors = lines.filter((l) => l.startsWith("ERROR:"));
    const text = (errors.length ? errors : lines).join("\n").slice(-600);

    let hint = "";

    if (/10054|10060|10061|Connection (aborted|reset|refused)|timed out|Unable to download webpage/i.test(stderr)) {
        hint = "Network-level failure: the connection to the site is being reset. The site may be blocked by your ISP/region or may be rejecting the request. Try a VPN/proxy (set YTDLP_PROXY), then update yt-dlp.";
    } else if (/HTTP Error 403|403: Forbidden/i.test(stderr)) {
        hint = "The site refused the request (403). Update yt-dlp, or provide browser cookies (set YTDLP_COOKIES_BROWSER=chrome).";
    } else if (/Sign in|login|private|members/i.test(stderr)) {
        hint = "This video requires you to be logged in. Provide browser cookies (YTDLP_COOKIES_BROWSER=chrome).";
    } else if (/Unsupported URL/i.test(stderr)) {
        hint = "yt-dlp has no extractor for this URL. Update yt-dlp (`yt-dlp -U`) and make sure the link points to the actual video page.";
    } else if (/DRM/i.test(stderr)) {
        hint = "This video is DRM-protected and cannot be downloaded.";
    } else if (/ffmpeg/i.test(stderr)) {
        hint = "ffmpeg is required for merging/converting. Install it or set FFMPEG_DIR.";
    }

    return hint ? `${hint}\n\n${text}` : text;
}

export function fetchVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const child = spawn(YTDLP_BIN, [...baseArgs(), "-J", "--no-playlist", url], SPAWN_OPTS);

        let stdout = "";
        let stderr = "";

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));

        child.on("error", (err) => {
            reject({ status: 500, message: `${YTDLP_NOT_FOUND} (${err.code || err.message})` });
        });

        child.on("close", (code) => {
            if (code !== 0) {
                return reject({
                    status: 500,
                    message: "Could not read video information.",
                    detail: explainError(stderr),
                });
            }

            try {
                const info = JSON.parse(stdout);
                resolve({
                    title: info.title || "Untitled",
                    thumbnail: info.thumbnail || null,
                    duration: info.duration || null,
                    source: info.extractor_key || info.extractor || null,
                });
            } catch {
                resolve({
                    title: "Video",
                    thumbnail: null,
                    duration: null,
                    source: null
                });
            }
        });
    });
}

export function startDownload({ url, quality, forceMp4, ffmpegDir }) {
    const jobId = randomUUID();
    const outputTemplate = path.join(DOWNLOAD_DIR, `${jobId}.%(ext)s`);

    const args = [...baseArgs(), "--no-playlist", "--newline", "-f", resolveFormat(quality), "-o", outputTemplate];

    if (ffmpegDir) {
        args.push("--ffmpeg-location", ffmpegDir);
    }

    if (quality === "audio") {
        args.push("--extract-audio", "--audio-format", "mp3");
    } else {
        args.push("--merge-output-format", "mp4");
        args.push("--postprocessor-args", "Merger:-c:v copy -c:a aac -b:a 192k");
        if (forceMp4) {
            args.push("--recode-video", "mp4");
        }
    }

    args.push(url);

    const job = createJob(jobId);
    const child = spawn(YTDLP_BIN, args, SPAWN_OPTS);
    let stderrAll = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
        const match = chunk.match(PROGRESS_PATTERN);
        if (match) {
            job.progress = parseFloat(match[1]);
        };
    });

    child.stderr.on("data", (chunk) => {
        stderrAll = (stderrAll + chunk).slice(-4000);
    });

    child.on("error", (err) => {
        job.status = "error";
        job.error = `${YTDLP_NOT_FOUND} (${err.message})`;
    });

    child.on("close", (code) => {
        if (code !== 0) {
            job.status = "error";
            job.error = explainError(stderrAll) || "yt-dlp exited with an error.";
            return;
        }

        const file = fs.readdirSync(DOWNLOAD_DIR).find((name) => name.startsWith(`${jobId}.`) && !name.endsWith(".part"));

        if (file) {
            job.filePath = path.join(DOWNLOAD_DIR, file);
            job.progress = 100;
            job.status = "done";
        } else {
            job.status = "error";
            job.error = "Download finished, but the output file was not found.";
        }
    });

    return jobId;
}

export { getJob };
