import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PORT = Number(process.env.PORT) || 3000;
export const YTDLP_BIN = process.env.YTDLP_PATH || "yt-dlp";

export const DOWNLOAD_DIR = path.join(os.tmpdir(), "video-downloader");
fs.mkdirSync(DOWNLOAD_DIR, {
    recursive: true
});

export function findFfmpegDir(rootDir) {
    const candidates = [process.env.FFMPEG_DIR, path.join(rootDir, "ffmpeg"), rootDir].filter(Boolean);
    for (const dir of candidates) {
        const hasFfmpeg = fs.existsSync(path.join(dir, "ffmpeg.exe")) || fs.existsSync(path.join(dir, "ffmpeg"));
        if (hasFfmpeg) {
            return dir;
        };
    }
    return null;
}

const QUALITY_FORMATS = {
    best: "bv*+ba/b",
    1080: "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
    720: "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
    480: "bv*[height<=480]+ba/b[height<=480]/bv*+ba/b",
    audio: "ba/b",
};

// Extra yt-dlp network options, configurable through environment variables:
//   YTDLP_PROXY=http://127.0.0.1:8080 (or socks5://127.0.0.1:1080)
//   YTDLP_COOKIES_BROWSER=chrome (chrome, firefox, edge, ...)
//   YTDLP_COOKIES_FILE=C:\path\cookies.txt
//   YTDLP_IMPERSONATE=chrome (needs: pip install "yt-dlp[curl-cffi]")
//   YTDLP_FORCE_IPV4=1
export function networkArgs() {
    const args = ["--retries", "5", "--fragment-retries", "5", "--socket-timeout", "20"];
    if (process.env.YTDLP_PROXY) {
        args.push("--proxy", process.env.YTDLP_PROXY);
    };
    if (process.env.YTDLP_COOKIES_BROWSER) {
        args.push("--cookies-from-browser", process.env.YTDLP_COOKIES_BROWSER);
    }
    if (process.env.YTDLP_COOKIES_FILE) {
        args.push("--cookies", process.env.YTDLP_COOKIES_FILE);
    }
    if (process.env.YTDLP_IMPERSONATE) {
        args.push("--impersonate", process.env.YTDLP_IMPERSONATE);
    }
    if (process.env.YTDLP_FORCE_IPV4 === "1") {
        args.push("--force-ipv4");
    }
    return args;
}

export function resolveFormat(quality) {
    return QUALITY_FORMATS[quality] || QUALITY_FORMATS.best;
}
