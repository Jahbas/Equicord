/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { ChatBarButton } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs } from "@utils/constants";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { saveFile } from "@utils/web";
import { FluxStore, VoiceState } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { Button, ChannelStore, moment, React, SelectedChannelStore, showToast, Toasts, UserStore, VoiceStateStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.callStreamRecorder as PluginNative<typeof import("./native")>;

interface VideoStreamStore extends FluxStore {
    getStreamId(userId: string, guildId: string | null | undefined, context?: string): string | undefined;
}
const VideoStreamStore = findStoreLazy("VideoStreamStore") as VideoStreamStore;

const RECORDING_MIME_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];

type StreamContext = "stream" | "default";

interface Intent {
    context: StreamContext;
    streamId: string;
}

interface ActiveRecording {
    recorder: MediaRecorder;
    chunks: Blob[];
}

const intents = new Map<string, Intent>();
const activeRecordings = new Map<string, ActiveRecording>();
const tileStreams = new Map<string, MediaStream>();
let activeSnapshot = new Set<string>();
const stateListeners = new Set<() => void>();

function emitState() {
    activeSnapshot = new Set(activeRecordings.keys());
    for (const listener of stateListeners) listener();
}

function subscribeState(listener: () => void) {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
}

const cl = classNameFactory("vc-callrec-");

function SaveDirRow({ setValue }: { setValue: (value: string) => void }) {
    const { saveDir } = settings.use(["saveDir"]);

    return (
        <div className={cl("dir-row")}>
            <span className={cl("dir-path")}>{saveDir || "No folder chosen yet"}</span>
            <Button size={Button.Sizes.MIN} onClick={async () => {
                const dir = await Native.pickSaveDir();
                if (dir) setValue(dir);
            }}>Choose folder</Button>
            {saveDir && <Button size={Button.Sizes.MIN} onClick={() => Native.openSaveDir(saveDir)}>Open folder</Button>}
        </div>
    );
}

export const settings = definePluginSettings({
    autoRecord: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Automatically record everyone streaming or on camera in your voice channel.",
    },
    recordStreams: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Record screenshares.",
    },
    recordWebcams: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Record webcams.",
    },
    mp4Output: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Convert recordings to MP4 (H.264) with native FFmpeg instead of keeping WebM.",
    },
    saveDir: {
        type: OptionType.COMPONENT,
        default: "",
        component: SaveDirRow,
    },
});

function parseStreamKey(streamKey: string): string | null {
    const parts = streamKey.split(":");
    if (parts[0] === "guild") return parts[3] ?? null;
    if (parts[0] === "call") return parts[2] ?? null;
    return null;
}

function tryStartRecording(userId: string) {
    if (activeRecordings.has(userId)) return;

    const intent = intents.get(userId);
    if (!intent) return;

    const stream = tileStreams.get(intent.streamId);
    if (!stream) return;

    const mimeType = RECORDING_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) ?? "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const recording: ActiveRecording = { recorder, chunks: [] };

    activeRecordings.set(userId, recording);
    emitState();

    const onTrackEnded = () => stopRecording(userId);
    stream.getVideoTracks().forEach(track => track.addEventListener("ended", onTrackEnded));

    recorder.ondataavailable = event => {
        if (event.data.size > 0) recording.chunks.push(event.data);
    };
    recorder.onstop = () => {
        stream.getVideoTracks().forEach(track => track.removeEventListener("ended", onTrackEnded));
        activeRecordings.delete(userId);
        emitState();
        finalizeRecording(userId, recording);
    };
    recorder.start(1000);
}

function startRecording(userId: string, guildId: string | null, context: StreamContext) {
    if (intents.has(userId) || userId === UserStore.getCurrentUser()?.id) return;

    const streamId = VideoStreamStore.getStreamId(userId, guildId, context);
    if (!streamId) return;

    intents.set(userId, { context, streamId });
    tryStartRecording(userId);
}

function stopRecording(userId: string) {
    intents.delete(userId);
    activeRecordings.get(userId)?.recorder.stop();
}

async function finalizeRecording(userId: string, recording: ActiveRecording) {
    const blob = new Blob(recording.chunks, { type: recording.recorder.mimeType || "video/webm" });
    if (!blob.size) return;

    const username = UserStore.getUser(userId)?.username ?? "unknown";
    const stamp = moment().format("YYYY-MM-DD_HH-mm-ss");
    const safeName = username.replace(/[\\/:*?"<>|]/g, "_");
    const baseName = `${safeName}-${stamp}`;

    let file = new File([blob], `${baseName}.webm`, { type: blob.type });
    if (settings.store.mp4Output) {
        try {
            const result = await Native.convertRecording(new Uint8Array(await blob.arrayBuffer()));
            if (!result.ok) throw new Error(result.error);
            const mp4Data = new ArrayBuffer(result.data.byteLength);
            new Uint8Array(mp4Data).set(result.data);
            file = new File([mp4Data], `${baseName}.mp4`, { type: "video/mp4" });
        } catch {
            showToast("Native FFmpeg conversion failed, saving as WebM instead", Toasts.Type.FAILURE);
        }
    }

    let dir: string | null = settings.store.saveDir;
    if (!dir) {
        dir = await Native.pickSaveDir();
        if (!dir) {
            saveFile(file);
            return;
        }
        settings.store.saveDir = dir;
    }
    dir = dir as string;

    const result = await Native.saveRecording(dir, file.name, new Uint8Array(await file.arrayBuffer()));
    if (result.ok) showToast(`Recording saved to ${result.path}`);
    else showToast(result.error, Toasts.Type.FAILURE);
}

function recordChannel(channelId: string): number {
    const channel = ChannelStore.getChannel(channelId);
    const guildId = channel?.guild_id ?? null;
    const voiceStates = Object.values(VoiceStateStore.getVoiceStatesForChannel(channelId));

    let started = 0;
    for (const state of voiceStates) {
        if (state.userId === UserStore.getCurrentUser()?.id) continue;
        if (state.selfStream && settings.store.recordStreams) {
            startRecording(state.userId, guildId, "stream");
            started++;
        } else if (state.selfVideo && settings.store.recordWebcams) {
            startRecording(state.userId, guildId, "default");
            started++;
        }
    }
    return started;
}

function toggleRecordAll() {
    if (intents.size) {
        for (const userId of [...intents.keys()]) stopRecording(userId);
        return;
    }

    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId) {
        showToast("Join a voice channel first", Toasts.Type.FAILURE);
        return;
    }

    const started = recordChannel(channelId);
    if (started) showToast(`Recording ${started} ${started === 1 ? "participant" : "participants"}`);
    else showToast("Nobody is streaming or on camera", Toasts.Type.FAILURE);
}

const RecordIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" fill="currentColor" />
    </svg>
);

const StopIcon = () => (
    <svg className={cl("stop-icon")} width="24" height="24" viewBox="0 0 24 24">
        <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
);

const CallRecordButton = ErrorBoundary.wrap(() => {
    const recording = React.useSyncExternalStore(subscribeState, () => activeSnapshot.size > 0);
    return (
        <ChatBarButton tooltip={recording ? "Stop recording" : "Record call"} onClick={toggleRecordAll}>
            {recording ? <StopIcon /> : <RecordIcon />}
        </ChatBarButton>
    );
}, { noop: true });

interface RTCVideoPayload {
    userId: string;
    guildId: string | null;
    streamId: string | null;
    context: StreamContext | undefined;
}

interface StreamDeletePayload {
    streamKey: string;
}

interface VoiceStateUpdatesPayload {
    voiceStates: VoiceState[];
}

export default definePlugin({
    name: "callStreamRecorder",
    authors: [EquicordDevs.dckrzw],
    description: "Record the screenshares and webcams of other users in your voice channel.",
    tags: ["Voice", "Utility"],
    settings,

    patches: [
        {
            find: /removeDirectVideoOutputSink\(\i\)/,
            replacement: {
                match: /(\i)\.release\(\)&&\((\i)\.delete\((\i)\),\(0,(\i)\.lE\)\(\)\.removeDirectVideoOutputSink\(\3\)\)/,
                replace: "$1.release()&&($2.delete($3),$self.onTileDetach($3),(0,$4.lE)().removeDirectVideoOutputSink($3))",
            },
        },
        {
            find: /addDirectVideoOutputSink\(\i\)/,
            replacement: {
                match: /null==(\i)&&\(\1=new (\i)\((\i)\),\(0,(\i)\.lE\)\(\)\.addDirectVideoOutputSink\(\3\),(\i)\.set\(\3,\1\)\)/,
                replace: "null==$1&&($1=new $2($3),(0,$4.lE)().addDirectVideoOutputSink($3),$5.set($3,$1),$self.onTileAttach($3,$1.stream))",
            },
        },
    ],

    flux: {
        RTC_CONNECTION_VIDEO(payload: RTCVideoPayload) {
            if (payload.userId === UserStore.getCurrentUser()?.id) return;

            const current = intents.get(payload.userId);
            if (current) {
                if (!payload.streamId) {
                    stopRecording(payload.userId);
                    return;
                }
                if (payload.streamId !== current.streamId || (payload.context && payload.context !== current.context)) {
                    stopRecording(payload.userId);
                    startRecording(payload.userId, payload.guildId, payload.context ?? current.context);
                }
                return;
            }

            if (!settings.store.autoRecord || !payload.streamId || !payload.context) return;
            if (payload.context === "stream" && !settings.store.recordStreams) return;
            if (payload.context === "default" && !settings.store.recordWebcams) return;
            startRecording(payload.userId, payload.guildId, payload.context);
        },
        STREAM_DELETE(payload: StreamDeletePayload) {
            const ownerId = parseStreamKey(payload.streamKey);
            if (!ownerId) return;
            if (intents.get(ownerId)?.context === "stream") stopRecording(ownerId);
        },
        VOICE_STATE_UPDATES(payload: VoiceStateUpdatesPayload) {
            const selfId = UserStore.getCurrentUser()?.id;
            const self = payload.voiceStates.find(state => state.userId === selfId);
            if (self && !self.channelId) {
                for (const userId of [...intents.keys()]) stopRecording(userId);
                return;
            }

            for (const state of payload.voiceStates) {
                const intent = intents.get(state.userId);
                if (!intent) continue;

                if (!state.channelId || (self && state.channelId !== self.channelId)) {
                    stopRecording(state.userId);
                    continue;
                }
                if (intent.context === "default" && !state.selfVideo) stopRecording(state.userId);
            }
        },
    },

    chatBarButton: {
        icon: RecordIcon,
        render: () => <CallRecordButton />,
    },

    onTileAttach(streamId: string, stream: MediaStream) {
        tileStreams.set(streamId, stream);
        for (const [userId, intent] of intents) {
            if (intent.streamId === streamId) tryStartRecording(userId);
        }
    },

    onTileDetach(streamId: string) {
        tileStreams.delete(streamId);
    },

    stop() {
        for (const userId of [...intents.keys()]) stopRecording(userId);
    },
});
