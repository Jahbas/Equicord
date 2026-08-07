/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ensureSafePath } from "@main/utils/ensureSafePath";
import { spawn } from "child_process";
import { dialog, IpcMainInvokeEvent, shell } from "electron";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const MAX_CONVERSION_BYTES = 2 * 1024 * 1024 * 1024;

function runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const process = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
        process.once("error", reject);
        process.once("close", code => code === 0 ? resolve() : reject(new Error("FFmpeg exited unsuccessfully.")));
    });
}

export async function pickSaveDir(_: IpcMainInvokeEvent): Promise<string | null> {
    const result = await dialog.showOpenDialog({
        title: "Choose a folder for recordings",
        properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
}

export async function openSaveDir(_: IpcMainInvokeEvent, dir: string): Promise<void> {
    if (dir) await shell.openPath(dir);
}

export async function convertRecording(
    _: IpcMainInvokeEvent,
    data: Uint8Array
): Promise<{ ok: true; data: Uint8Array } | { ok: false; error: string }> {
    if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_CONVERSION_BYTES)
        return { ok: false, error: "Invalid recording data." };

    let workDir: string | undefined;
    try {
        workDir = await mkdtemp(join(tmpdir(), "equicord-callrec-"));
        const inputPath = join(workDir, "recording.webm");
        const outputPath = join(workDir, "recording.mp4");
        await writeFile(inputPath, data);
        await runFfmpeg([
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-i", inputPath,
            "-map", "0:v:0",
            "-map", "0:a:0?",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-profile:v", "high",
            "-level:v", "4.0",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            outputPath,
        ]);
        return { ok: true, data: await readFile(outputPath) };
    } catch {
        return { ok: false, error: "Couldn't convert the recording. Make sure FFmpeg is installed." };
    } finally {
        if (workDir) await rm(workDir, { recursive: true, force: true });
    }
}

export async function saveRecording(
    _: IpcMainInvokeEvent,
    dir: string,
    fileName: string,
    data: Uint8Array
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
    if (!dir || !fileName || !(data instanceof Uint8Array))
        return { ok: false, error: "Invalid save request." };

    const safePath = ensureSafePath(dir, fileName);
    if (!safePath) return { ok: false, error: "Invalid save path." };

    try {
        await mkdir(dir, { recursive: true });
        await writeFile(safePath, data);
        return { ok: true, path: safePath };
    } catch {
        return { ok: false, error: "Couldn't save the recording." };
    }
}
